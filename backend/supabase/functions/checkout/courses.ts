// Course lookup for checkout. Always goes through the service-role client
// (see `handler.ts`) even though `public.courses` grants SELECT to
// `authenticated` too -- money-critical reads should be authoritative, not
// RLS-dependent, per this task's spec.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublishedCourse {
  readonly id: string;
  readonly title: string;
  readonly priceCents: number;
}

export class CourseLookupError extends Error {
  constructor(message: string) {
    super(`Failed to look up course: ${message}`);
    this.name = 'CourseLookupError';
  }
}

const PUBLISHED_STATUS = 'published';

// Returns null both when the course row does not exist and when it exists
// but is not published -- the caller (`handler.ts`) must map both to the
// same 404 `course_not_found` response without distinguishing them, the
// same "never leak existence beyond what's necessary" principle
// `app.get_playable_ref` applies to lessons (see its migration comment).
export async function fetchPublishedCourse(
  client: SupabaseClient,
  courseId: string,
): Promise<PublishedCourse | null> {
  const { data, error } = await client
    .from('courses')
    .select('id, title, price_cents, status')
    .eq('id', courseId)
    .maybeSingle();

  if (error) {
    throw new CourseLookupError(error.message);
  }
  if (!data || data.status !== PUBLISHED_STATUS) {
    return null;
  }
  return { id: data.id, title: data.title, priceCents: data.price_cents };
}
