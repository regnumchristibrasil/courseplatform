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

export function lessonRoute(courseId: string, lessonId: string): string {
  return `${myCourseRoute(courseId)}/aulas/${lessonId}`;
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

export const LESSON_STATES = ['not_started', 'in_progress', 'completed'] as const;
export type LessonState = (typeof LESSON_STATES)[number];

// Mirrors the single row of app.my_course_tree(course_id): active modules and
// lessons only, already ordered. The server returns zero rows (never an
// error) for anyone without access, which the client shows as "not found".
export interface CourseTreeLesson {
  readonly id: string;
  readonly title: string;
  readonly durationSeconds: number | null;
  readonly state: LessonState;
}

export interface CourseTreeModule {
  readonly id: string;
  readonly title: string;
  readonly lessons: readonly CourseTreeLesson[];
}

export interface CourseTree {
  readonly courseId: string;
  readonly title: string;
  readonly description: string | null;
  readonly courseStatus: MyCourseStatus;
  readonly isStaff: boolean;
  readonly totalLessons: number;
  readonly completedLessons: number;
  readonly progressPercent: number;
  readonly totalDurationSeconds: number;
  readonly continueLessonId: string | null;
  readonly modules: readonly CourseTreeModule[];
}

// With everything completed the server points "continue" at the first lesson.
export function isCourseCompleted(
  tree: Pick<CourseTree, 'totalLessons' | 'completedLessons'>,
): boolean {
  return tree.totalLessons > 0 && tree.completedLessons >= tree.totalLessons;
}

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_RATE_LIMIT_PER_MINUTE = 10;
export const COMMENT_PAGE_SIZE = 20;

// Mirrors the rows of app.list_lesson_comments() / app.create_lesson_comment().
// The author is projected as first name plus a staff flag; no e-mail or user id.
// parentId is null for a root comment; replies are one level deep. A removed
// root (isDeleted) arrives with an empty author and body and is only listed
// while it still has live replies.
export interface LessonComment {
  readonly id: string;
  readonly parentId: string | null;
  readonly authorFirstName: string;
  readonly isStaffAuthor: boolean;
  readonly body: string;
  readonly createdAt: string;
  readonly isOwn: boolean;
  readonly isDeleted: boolean;
  readonly canDelete: boolean;
}

// A root comment with its live replies, oldest reply first.
export interface CommentThread {
  readonly root: LessonComment;
  readonly replies: readonly LessonComment[];
}

// Keyset cursor (created_at, id) over root comments, newest first. The server
// returns up to COMMENT_PAGE_SIZE + 1 roots; the extra root only signals that
// more exist and comes without replies.
export interface CommentCursor {
  readonly createdAt: string;
  readonly id: string;
}

export type StudentAreaErrorCode = 'unauthorized' | 'forbidden' | 'rate_limited' | 'invalid_input';

export const STUDENT_AREA_ERROR_CODES: readonly StudentAreaErrorCode[] = [
  'unauthorized',
  'forbidden',
  'rate_limited',
  'invalid_input',
];
