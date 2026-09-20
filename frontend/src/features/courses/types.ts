// Mirrors the `courses_public` PostgREST view column-for-column (snake_case
// on purpose — this is a direct, read-only projection of the view, not a
// DTO worth an extra mapping layer). See prompt_course_platform.md's
// "Data model" section for the source of truth.
export interface CoursePublic {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly price_cents: number
  readonly access_duration_days: number | null
}
