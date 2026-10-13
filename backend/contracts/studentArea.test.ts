import { assertEquals } from '@std/assert';
import {
  canRepurchase,
  COMMENT_MAX_LENGTH,
  COMMENT_RATE_LIMIT_PER_MINUTE,
  STUDENT_AREA_ERROR_CODES,
} from './studentArea.ts';

// Expectations written by hand from ADR 0004, not derived from the implementation.
Deno.test('canRepurchase only for an expired enrollment in a published course', () => {
  assertEquals(canRepurchase({ isExpired: true, courseStatus: 'published' }), true);
  assertEquals(canRepurchase({ isExpired: true, courseStatus: 'draft' }), false);
  assertEquals(canRepurchase({ isExpired: true, courseStatus: 'archived' }), false);
  assertEquals(canRepurchase({ isExpired: false, courseStatus: 'published' }), false);
});

Deno.test('limits match ADR 0004', () => {
  assertEquals(COMMENT_MAX_LENGTH, 2000);
  assertEquals(COMMENT_RATE_LIMIT_PER_MINUTE, 10);
});

Deno.test('error codes include the distinct rate_limited code', () => {
  assertEquals(STUDENT_AREA_ERROR_CODES.includes('rate_limited'), true);
  assertEquals(new Set(STUDENT_AREA_ERROR_CODES).size, STUDENT_AREA_ERROR_CODES.length);
});
