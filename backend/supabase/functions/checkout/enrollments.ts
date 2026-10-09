// Enrollment lookup for checkout (ADR 0003): a student who still has valid
// access must be refused before any order or charge exists. Runs on the
// service-role client like the other money-critical reads in this folder.
//
// "Valid access" mirrors app.has_active_enrollment: status 'active' and
// either lifetime (expires_at NULL) or not yet expired. The is_active user
// gate is enforced separately by `checkUserIsActive` in `handler.ts`.

import type { SupabaseClient } from '@supabase/supabase-js';

const ACTIVE_STATUS = 'active';

export class EnrollmentLookupError extends Error {
  constructor(message: string) {
    super(`Failed to look up enrollment: ${message}`);
    this.name = 'EnrollmentLookupError';
  }
}

export async function hasValidAccess(
  client: SupabaseClient,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from('enrollments')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .eq('status', ACTIVE_STATUS)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new EnrollmentLookupError(error.message);
  }
  return data !== null && data !== undefined;
}
