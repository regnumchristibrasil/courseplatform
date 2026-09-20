import { assertEquals, assertThrows } from '@std/assert';
import { InvalidCheckoutRequestError, validateCheckoutRequestBody } from './validate-request.ts';

Deno.test('validateCheckoutRequestBody accepts a body with a non-empty courseId', () => {
  const result = validateCheckoutRequestBody({ courseId: 'course-1' });
  assertEquals(result, { courseId: 'course-1' });
});

Deno.test('validateCheckoutRequestBody rejects a missing courseId', () => {
  assertThrows(
    () => validateCheckoutRequestBody({}),
    InvalidCheckoutRequestError,
    'courseId',
  );
});

Deno.test('validateCheckoutRequestBody rejects a null courseId', () => {
  assertThrows(
    () => validateCheckoutRequestBody({ courseId: null }),
    InvalidCheckoutRequestError,
  );
});

Deno.test('validateCheckoutRequestBody rejects a non-string courseId', () => {
  assertThrows(
    () => validateCheckoutRequestBody({ courseId: 42 }),
    InvalidCheckoutRequestError,
  );
});

Deno.test('validateCheckoutRequestBody rejects an empty-string courseId', () => {
  assertThrows(
    () => validateCheckoutRequestBody({ courseId: '' }),
    InvalidCheckoutRequestError,
  );
});

Deno.test('validateCheckoutRequestBody rejects a whitespace-only courseId', () => {
  assertThrows(
    () => validateCheckoutRequestBody({ courseId: '   ' }),
    InvalidCheckoutRequestError,
  );
});

Deno.test('validateCheckoutRequestBody rejects a null body', () => {
  assertThrows(() => validateCheckoutRequestBody(null), InvalidCheckoutRequestError);
});

Deno.test('validateCheckoutRequestBody rejects a non-object body (array)', () => {
  assertThrows(() => validateCheckoutRequestBody(['course-1']), InvalidCheckoutRequestError);
});

Deno.test('validateCheckoutRequestBody rejects a non-object body (string)', () => {
  assertThrows(() => validateCheckoutRequestBody('course-1'), InvalidCheckoutRequestError);
});
