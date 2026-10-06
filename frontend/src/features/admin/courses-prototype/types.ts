// PROTOTYPE (throwaway): admin course management, wayfinder ticket #8.
// Question: "what should the course/module/lesson management area look like?"
// Three variants on /admin/courses/:courseId?variant=A|B|C. All data is in
// memory; nothing here talks to the backend.

export type Provider = 'youtube' | 'panda'
export type CourseStatus = 'draft' | 'published' | 'archived'

export interface Video {
  readonly provider: Provider
  readonly ref: string
}

export interface Lesson {
  readonly id: string
  readonly title: string
  readonly durationSeconds: number | null
  readonly isFreePreview: boolean
  readonly archived: boolean
  readonly video: Video | null
}

export interface CourseModule {
  readonly id: string
  readonly title: string
  readonly archived: boolean
  readonly lessons: readonly Lesson[]
}

export interface Course {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly priceCents: number
  readonly accessDurationDays: number | null
  readonly status: CourseStatus
  readonly enrollments: number
  readonly pendingOrders: number
  readonly modules: readonly CourseModule[]
}

export type ErrorCode =
  | 'publish_gate_violated'
  | 'invalid_input'
  | 'has_sales'
  | 'module_not_empty'
  | 'invalid_transition'
  | 'not_found'

export type Result =
  | { readonly ok: true; readonly warning?: string }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string }

export interface AuditEntry {
  readonly id: string
  readonly at: string
  readonly action: string
  readonly detail: string
}

export interface Outcome {
  readonly courses: readonly Course[]
  readonly result: Result
  readonly audit?: { readonly action: string; readonly detail: string }
}

export interface LessonInput {
  readonly title: string
  readonly durationText: string
  readonly isFreePreview: boolean
  readonly videoText: string
}

export interface CourseMetaInput {
  readonly title: string
  readonly description: string
  readonly priceText: string
  readonly durationText: string
}

export type Direction = 'up' | 'down'
