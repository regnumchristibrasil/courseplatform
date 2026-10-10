import {
  type AdminCoursesRequest,
  COURSE_STATUS_TRANSITIONS,
  type CourseStatus,
  MAX_ACCESS_DURATION_DAYS,
  MAX_COURSE_DESCRIPTION_LENGTH,
  MAX_COURSE_TITLE_LENGTH,
  MAX_PRICE_CENTS,
  MIN_ACCESS_DURATION_DAYS,
  MIN_PRICE_CENTS,
} from '../../../contracts/adminCourses.ts';

export class InvalidCourseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCourseRequestError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO-8601 com fracao opcional (microssegundos) e offset; so o formato, o banco compara.
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const FIELD_NAMES = ['action', 'title', 'description', 'priceCents', 'accessDurationDays'];
const FIELDS_BY_ACTION: Readonly<Record<string, ReadonlySet<string>>> = {
  create: new Set(FIELD_NAMES),
  update: new Set([...FIELD_NAMES, 'courseId', 'expectedUpdatedAt']),
  set_status: new Set(['action', 'courseId', 'expectedUpdatedAt', 'status']),
  delete: new Set(['action', 'courseId', 'expectedUpdatedAt']),
};
const COURSE_STATUSES = Object.keys(COURSE_STATUS_TRANSITIONS) as readonly CourseStatus[];

function fail(message: string): never {
  throw new InvalidCourseRequestError(message);
}

function nullableInt(value: unknown, name: string, min: number, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${name} must be null or an integer between ${min} and ${max}`);
  }
  return value;
}

function targetOf(
  record: Record<string, unknown>,
): { courseId: string; expectedUpdatedAt: string } {
  const { courseId, expectedUpdatedAt } = record;
  if (typeof courseId !== 'string' || !UUID_PATTERN.test(courseId)) fail('courseId must be a uuid');
  if (typeof expectedUpdatedAt !== 'string' || !TIMESTAMP_PATTERN.test(expectedUpdatedAt)) {
    fail('expectedUpdatedAt must be an ISO timestamp string');
  }
  return { courseId, expectedUpdatedAt };
}

function validateTargetRequest(
  record: Record<string, unknown>,
  action: 'set_status' | 'delete',
): AdminCoursesRequest {
  const target = targetOf(record);
  if (action === 'delete') return { action, ...target };
  const status = COURSE_STATUSES.find((candidate) => candidate === record.status);
  if (status === undefined) fail(`status must be one of ${COURSE_STATUSES.join(', ')}`);
  return { action, ...target, status };
}

// Validacao estrita na fronteira: campos desconhecidos (inclusive qualquer
// identidade de ator) sao rejeitados; o ator vem somente do JWT.
export function validateCourseRequest(body: unknown): AdminCoursesRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail('Request body must be a JSON object');
  }
  const record = body as Record<string, unknown>;
  const action = record.action;
  const allowed = typeof action === 'string' ? FIELDS_BY_ACTION[action] : undefined;
  if (allowed === undefined) fail("action must be 'create', 'update', 'set_status' or 'delete'");
  if (Object.keys(record).some((key) => !allowed.has(key))) fail('Unknown fields in request body');

  if (action === 'set_status' || action === 'delete') return validateTargetRequest(record, action);

  const { title, description } = record;
  if (
    typeof title !== 'string' || title.trim() === '' ||
    [...title.trim()].length > MAX_COURSE_TITLE_LENGTH
  ) {
    fail(`title must be 1 to ${MAX_COURSE_TITLE_LENGTH} characters`);
  }
  if (
    description !== null &&
    (typeof description !== 'string' || [...description].length > MAX_COURSE_DESCRIPTION_LENGTH)
  ) {
    fail(`description must be null or at most ${MAX_COURSE_DESCRIPTION_LENGTH} characters`);
  }
  const fields = {
    title,
    description,
    priceCents: nullableInt(record.priceCents, 'priceCents', MIN_PRICE_CENTS, MAX_PRICE_CENTS),
    accessDurationDays: nullableInt(
      record.accessDurationDays,
      'accessDurationDays',
      MIN_ACCESS_DURATION_DAYS,
      MAX_ACCESS_DURATION_DAYS,
    ),
  };
  if (action === 'create') return { action, ...fields };

  return { action: 'update', ...targetOf(record), ...fields };
}
