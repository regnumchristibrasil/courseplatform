// Selects `app_private.email_outbox` rows worth attempting a send for --
// never attempted (`pending`) or previously failed with attempts remaining
// (`failed` AND `attempts < 5`). Per this task's status-model note:
// `dead_lettered`/`sent` are terminal and must never be re-picked; `failed`
// with `attempts >= 5` is functionally the same as dead-lettered and is
// excluded by the same `attempts < 5` filter (it should already have been
// flipped to `dead_lettered` by the tick that pushed it past 5, but the
// filter is a defensive belt-and-suspenders in case that write ever fails).

import type { SupabaseClient } from '@supabase/supabase-js';

const APP_PRIVATE_SCHEMA = 'app_private';
const EMAIL_OUTBOX_TABLE = 'email_outbox';
const ELIGIBLE_STATUSES = ['pending', 'failed'] as const;
const MAX_ATTEMPTS = 5; // NFR: 5 attempts with backoff, then dead-letter.

export class CandidateEmailsLookupError extends Error {
  constructor(message: string) {
    super(`Failed to look up outbox drain candidate emails: ${message}`);
    this.name = 'CandidateEmailsLookupError';
  }
}

export interface CandidateEmail {
  readonly id: string;
  readonly template: string;
  readonly toEmail: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
}

interface CandidateEmailRow {
  readonly id: string;
  readonly template: string;
  readonly to_email: string;
  readonly payload: Record<string, unknown> | null;
  readonly attempts: number;
}

export async function fetchCandidateEmails(
  client: SupabaseClient,
  limit: number,
): Promise<readonly CandidateEmail[]> {
  const { data, error } = await client
    .schema(APP_PRIVATE_SCHEMA)
    .from(EMAIL_OUTBOX_TABLE)
    .select('id, template, to_email, payload, attempts')
    .in('status', ELIGIBLE_STATUSES)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new CandidateEmailsLookupError(error.message);
  }

  const rows = (data ?? []) as readonly CandidateEmailRow[];
  return rows.map((row) => ({
    id: row.id,
    template: row.template,
    toEmail: row.to_email,
    payload: row.payload ?? {},
    attempts: row.attempts,
  }));
}
