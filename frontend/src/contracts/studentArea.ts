// Student area contract, shared verbatim between frontend and backend (see
// ADR 0004). Edit both copies together; the parity test fails on drift.
// Client-side checks are UX only: every RPC re-validates in the database.

export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const;
export type MyCourseStatus = (typeof COURSE_STATUSES)[number];

export const STUDENT_AREA_ROUTES = {
  myCourses: '/meus-cursos',
  catalog: '/',
} as const;

export function myCourseRoute(courseId: string): string {
  return `${STUDENT_AREA_ROUTES.myCourses}/${courseId}`;
}

// Mirrors the rows of app.my_courses(). Counts are active lessons only
// (archived lessons and lessons in archived modules are excluded).
export interface MyCourse {
  readonly courseId: string;
  readonly title: string;
  readonly courseStatus: MyCourseStatus;
  readonly isExpired: boolean;
  readonly expiresAt: string | null;
  readonly totalLessons: number;
  readonly completedLessons: number;
  readonly progressPercent: number;
}

// Repurchase is only offered for an expired enrollment in a published course.
export function canRepurchase(course: Pick<MyCourse, 'isExpired' | 'courseStatus'>): boolean {
  return course.isExpired && course.courseStatus === 'published';
}

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_RATE_LIMIT_PER_MINUTE = 10;

export type StudentAreaErrorCode = 'unauthorized' | 'forbidden' | 'rate_limited' | 'invalid_input';

export const STUDENT_AREA_ERROR_CODES: readonly StudentAreaErrorCode[] = [
  'unauthorized',
  'forbidden',
  'rate_limited',
  'invalid_input',
];
