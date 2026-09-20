import type { SupabaseClient } from '@supabase/supabase-js'
import type { CoursePublic } from './types'

// Per the NFR budget: catalog and lesson list query PostgREST directly,
// never through an Edge Function.
const COURSES_PUBLIC_VIEW = 'courses_public'
const COURSES_PUBLIC_COLUMNS = 'id, title, description, price_cents, access_duration_days'

export async function fetchPublishedCourses(client: SupabaseClient): Promise<readonly CoursePublic[]> {
  const { data, error } = await client
    .from(COURSES_PUBLIC_VIEW)
    .select(COURSES_PUBLIC_COLUMNS)
    .order('title', { ascending: true })

  if (error) {
    throw new Error(`Failed to load course catalog: ${error.message}`)
  }

  return (data ?? []) as unknown as readonly CoursePublic[]
}
