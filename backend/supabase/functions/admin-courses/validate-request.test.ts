import { assertEquals, assertThrows } from '@std/assert';
import { InvalidCourseRequestError, validateCourseRequest } from './validate-request.ts';

const COURSE_ID = '11111111-1111-4111-8111-111111111111';
const UPDATED_AT = '2026-10-09T22:35:59.123456+00:00';
const create = {
  action: 'create' as const,
  title: 'Curso',
  description: null,
  priceCents: null,
  accessDurationDays: null,
};
const update = {
  ...create,
  action: 'update' as const,
  courseId: COURSE_ID,
  expectedUpdatedAt: UPDATED_AT,
};

function invalid(body: unknown): void {
  assertThrows(() => validateCourseRequest(body), InvalidCourseRequestError);
}

Deno.test('accepts a create request and trims nothing (server normalizes)', () => {
  assertEquals(validateCourseRequest({ ...create, priceCents: 9900, accessDurationDays: 30 }), {
    ...create,
    priceCents: 9900,
    accessDurationDays: 30,
  });
});

Deno.test('accepts an update request keeping the microsecond timestamp string', () => {
  assertEquals(validateCourseRequest(update), update);
});

Deno.test('rejects non-objects, unknown fields (incl. actor identity) and bad action', () => {
  invalid(null);
  invalid([]);
  invalid({ ...create, actorId: COURSE_ID });
  invalid({ ...create, action: 'delete' });
  invalid({ ...create, status: 'published' });
});

Deno.test('rejects invalid title and description', () => {
  invalid({ ...create, title: '' });
  invalid({ ...create, title: '   ' });
  invalid({ ...create, title: 'x'.repeat(201) });
  invalid({ ...create, title: 42 });
  invalid({ ...create, description: 'x'.repeat(5001) });
  invalid({ ...create, description: 7 });
});

Deno.test('rejects out-of-range or non-integer price and duration', () => {
  invalid({ ...create, priceCents: 0 });
  invalid({ ...create, priceCents: 10_000_001 });
  invalid({ ...create, priceCents: 99.5 });
  invalid({ ...create, priceCents: '100' });
  invalid({ ...create, accessDurationDays: 0 });
  invalid({ ...create, accessDurationDays: 36_501 });
  invalid({ ...create, accessDurationDays: 1.5 });
  const { priceCents: _omit, ...missing } = create;
  invalid(missing);
});

Deno.test('update requires uuid courseId and a timestamp string', () => {
  invalid({ ...update, courseId: 'nope' });
  invalid({ ...update, expectedUpdatedAt: '' });
  invalid({ ...update, expectedUpdatedAt: 'yesterday' });
  invalid({ ...update, expectedUpdatedAt: 123 });
  const { courseId: _omit, ...missing } = update;
  invalid(missing);
});

Deno.test('create rejects update-only fields', () => {
  invalid({ ...create, courseId: COURSE_ID });
  invalid({ ...create, expectedUpdatedAt: UPDATED_AT });
});
