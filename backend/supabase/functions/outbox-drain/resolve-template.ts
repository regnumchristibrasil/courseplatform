// Turns one `app_private.email_outbox` candidate row into the clean,
// renderer-ready data shape the `_shared/email` templates expect. The email
// module itself only renders from already-resolved data (see
// `_shared/email/types.ts`) -- joining the outbox row's `template`/`payload`
// back to `users`/`courses`/`orders` is this task's own responsibility, not
// something the shared module does.
//
// Every failure path here (unsupported template, missing payload field, a
// lookup erroring, or a lookup finding no row) throws `TemplateResolutionError`
// -- a real `Error` instance so the caller always has something meaningful to
// hand to `captureExceptionAndFlush`. This module never talks to Resend and
// never mutates `email_outbox`; that is `process-candidate.ts`'s job.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PurchaseConfirmationEmailData, WelcomeEmailData } from '../_shared/email/types.ts';
import type { CandidateEmail } from './candidates.ts';

const WELCOME_TEMPLATE = 'welcome';
const PURCHASE_CONFIRMATION_TEMPLATE = 'purchase_confirmation';

export class TemplateResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateResolutionError';
  }
}

export type ResolvedTemplateData =
  | { readonly template: 'welcome'; readonly data: WelcomeEmailData }
  | {
    readonly template: 'purchase_confirmation';
    readonly data: PurchaseConfirmationEmailData;
  };

interface UserRow {
  readonly full_name: string | null;
}

interface CourseRow {
  readonly title: string;
}

interface OrderRow {
  readonly amount_cents: number;
  readonly currency: string;
}

function requireStringPayloadField(
  candidate: CandidateEmail,
  field: string,
): string {
  const value = candidate.payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TemplateResolutionError(
      `email outbox row ${candidate.id} (template "${candidate.template}") is missing a valid payload.${field}`,
    );
  }
  return value;
}

async function resolveWelcome(
  supabase: SupabaseClient,
  candidate: CandidateEmail,
): Promise<ResolvedTemplateData> {
  const userId = requireStringPayloadField(candidate, 'user_id');

  const { data, error } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new TemplateResolutionError(
      `failed to look up user ${userId} for email outbox row ${candidate.id}: ${error.message}`,
    );
  }
  if (!data) {
    throw new TemplateResolutionError(
      `user ${userId} not found for email outbox row ${candidate.id}`,
    );
  }

  const userRow = data as UserRow;
  return {
    template: 'welcome',
    data: { toEmail: candidate.toEmail, userFullName: userRow.full_name },
  };
}

// Uses the order's own `amount_cents`/`currency` (what was actually charged)
// as the authoritative amount, never `courses.price_cents` -- a course's
// listed price can change after purchase, but the receipt must always
// reflect what the buyer paid.
async function resolvePurchaseConfirmation(
  supabase: SupabaseClient,
  candidate: CandidateEmail,
): Promise<ResolvedTemplateData> {
  const courseId = requireStringPayloadField(candidate, 'course_id');
  const orderId = requireStringPayloadField(candidate, 'order_id');

  const { data: courseData, error: courseError } = await supabase
    .from('courses')
    .select('title')
    .eq('id', courseId)
    .maybeSingle();

  if (courseError) {
    throw new TemplateResolutionError(
      `failed to look up course ${courseId} for email outbox row ${candidate.id}: ${courseError.message}`,
    );
  }
  if (!courseData) {
    throw new TemplateResolutionError(
      `course ${courseId} not found for email outbox row ${candidate.id}`,
    );
  }

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('amount_cents, currency')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError) {
    throw new TemplateResolutionError(
      `failed to look up order ${orderId} for email outbox row ${candidate.id}: ${orderError.message}`,
    );
  }
  if (!orderData) {
    throw new TemplateResolutionError(
      `order ${orderId} not found for email outbox row ${candidate.id}`,
    );
  }

  const courseRow = courseData as CourseRow;
  const orderRow = orderData as OrderRow;

  return {
    template: 'purchase_confirmation',
    data: {
      toEmail: candidate.toEmail,
      courseTitle: courseRow.title,
      amountCents: orderRow.amount_cents,
      currency: orderRow.currency,
    },
  };
}

// Any `template` value other than the two implemented ones -- including the
// stub-only `password_reset`/`course_completion` (see
// `_shared/email/templates/stubs.ts`) -- is treated uniformly as "this row's
// template can't be rendered right now": deliberately not special-cased,
// per this task's spec.
export async function resolveTemplateData(
  supabase: SupabaseClient,
  candidate: CandidateEmail,
): Promise<ResolvedTemplateData> {
  switch (candidate.template) {
    case WELCOME_TEMPLATE:
      return await resolveWelcome(supabase, candidate);
    case PURCHASE_CONFIRMATION_TEMPLATE:
      return await resolvePurchaseConfirmation(supabase, candidate);
    default:
      throw new TemplateResolutionError(
        `unsupported email template "${candidate.template}" for outbox row ${candidate.id}`,
      );
  }
}
