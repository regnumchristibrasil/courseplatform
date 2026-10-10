// Admin course management contract, shared verbatim between frontend and
// backend (see ADR 0002 and ticket #14). The permission matrix mirrors the
// server-side rules in the course RPCs:
// - Staff (tutor, admin, superadmin) manage every course; students never do.
// - Tutors edit content and status and may delete, but never touch the
//   commercial fields (price and access duration), which stay with
//   admin/superadmin (ADR 0002, decision 4).
// Client-side guards are UX only; the database re-checks everything.

export type CourseActorRole = 'superadmin' | 'admin' | 'tutor' | 'student';

export const COURSE_ROLES: readonly CourseActorRole[] = [
  'superadmin',
  'admin',
  'tutor',
  'student',
];

export type CourseStatus = 'draft' | 'published' | 'archived';

export type CourseAction =
  | 'list'
  | 'create'
  | 'edit_details'
  | 'edit_price'
  | 'edit_access_duration'
  | 'edit_content'
  | 'change_status'
  | 'delete';

export const COURSE_ACTIONS: readonly CourseAction[] = [
  'list',
  'create',
  'edit_details',
  'edit_price',
  'edit_access_duration',
  'edit_content',
  'change_status',
  'delete',
];

// Row returned by app.staff_list_courses(), already mapped to camelCase.
export interface CourseListRow {
  readonly courseId: string;
  readonly title: string;
  readonly status: CourseStatus;
  readonly priceCents: number | null; // null only while draft
  readonly accessDurationDays: number | null; // null = lifetime access
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly enrollmentCount: number; // active enrollments
  readonly pendingOrderCount: number;
}

export type VideoProvider = 'youtube' | 'panda';

// Active video reference of a lesson, readable only through the staff RPCs.
export interface LessonVideo {
  readonly provider: VideoProvider;
  readonly externalRef: string;
}

export interface LessonNode {
  readonly lessonId: string;
  readonly title: string;
  readonly position: number;
  readonly durationSeconds: number | null;
  readonly isFreePreview: boolean;
  readonly archivedAt: string | null;
  // updated_at exactly as read (microsecond string); token of the optimistic lock.
  readonly updatedAt: string;
  readonly video: LessonVideo | null; // null = no active video
}

// Editable lesson fields (the video is managed separately, see ticket #19).
export interface LessonFieldsInput {
  readonly title: string;
  readonly durationSeconds: number | null; // null = unknown
  readonly isFreePreview: boolean;
}

export interface ModuleNode {
  readonly moduleId: string;
  readonly title: string;
  readonly position: number;
  readonly archivedAt: string | null;
  readonly lessons: readonly LessonNode[]; // ordered by position, archived included
}

// Result of app.staff_get_course(): the whole tree, archived items included.
export interface CourseTree extends CourseListRow {
  readonly description: string | null;
  readonly modules: readonly ModuleNode[]; // ordered by position, archived included
}

export type AdminCoursesErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'stale_target'
  | 'module_not_empty' // a module that still has lessons cannot be deleted
  | 'course_has_sales' // a course with enrollments or orders only archives
  | 'publish_gate_violated'; // an active lesson without video in a published course

// Field limits mirrored by app_private.assert_valid_course_fields and the
// courses_price_range CHECK. Change SQL and this file together.
export const MAX_COURSE_TITLE_LENGTH = 200;
export const MAX_COURSE_DESCRIPTION_LENGTH = 5000;
export const MAX_MODULE_TITLE_LENGTH = 200; // mirrored by app_private.assert_valid_module_title
export const MAX_LESSON_TITLE_LENGTH = 200; // mirrored by app_private.assert_valid_lesson_fields
export const MIN_LESSON_DURATION_SECONDS = 1; // optional; null = unknown
export const MAX_LESSON_DURATION_SECONDS = 86_400;
export const MIN_PRICE_CENTS = 1;
export const MAX_PRICE_CENTS = 10_000_000; // R$ 100.000,00
export const MIN_ACCESS_DURATION_DAYS = 1;
export const MAX_ACCESS_DURATION_DAYS = 36_500;

// HTTP status used by the admin-courses Edge Function. Clients decide by the
// stable code, never by the status (direct RPC calls map statuses differently).
export const ADMIN_COURSES_ERROR_STATUS: Readonly<Record<AdminCoursesErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  stale_target: 409,
  module_not_empty: 409,
  course_has_sales: 409,
  publish_gate_violated: 409,
};

// Editable course fields. The editor always sends the full state; a tutor
// must resend the current price/duration unchanged (null stays null).
export interface CourseFieldsInput {
  readonly title: string;
  readonly description: string | null;
  readonly priceCents: number | null;
  readonly accessDurationDays: number | null; // null = lifetime access
}

export interface CreateCourseRequest extends CourseFieldsInput {
  readonly action: 'create';
}

export interface UpdateCourseRequest extends CourseFieldsInput {
  readonly action: 'update';
  readonly courseId: string;
  // updated_at exactly as read (microsecond string); never round-trip via Date.
  readonly expectedUpdatedAt: string;
}

export type AdminCoursesRequest = CreateCourseRequest | UpdateCourseRequest;

export interface SaveCourseResponse {
  readonly courseId: string;
  readonly updatedAt: string;
}

const COMMERCIAL_ACTIONS: readonly CourseAction[] = ['edit_price', 'edit_access_duration'];

// Pure rule check, usable by the guard layer on both sides.
export function evaluateCoursePermission(role: CourseActorRole, action: CourseAction): boolean {
  if (role === 'superadmin' || role === 'admin') return true;
  if (role === 'tutor') return !COMMERCIAL_ACTIONS.includes(action);
  return false;
}

export interface CoursePermissionRow {
  readonly role: CourseActorRole;
  readonly action: CourseAction;
  readonly allowed: boolean;
}

export const COURSE_PERMISSION_MATRIX: readonly CoursePermissionRow[] = COURSE_ROLES.flatMap(
  (role) =>
    COURSE_ACTIONS.map((action): CoursePermissionRow => ({
      role,
      action,
      allowed: evaluateCoursePermission(role, action),
    })),
);
