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
  readonly priceCents: number;
  readonly accessDurationDays: number | null; // null = lifetime access
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly enrollmentCount: number; // active enrollments
  readonly pendingOrderCount: number;
}

export type AdminCoursesErrorCode = 'forbidden';

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
