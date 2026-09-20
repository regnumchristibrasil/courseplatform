import { assertEquals, assertThrows } from '@std/assert';
import { InvalidLimitError, resolveEffectiveLimit } from './body.ts';

Deno.test('resolveEffectiveLimit defaults to 50 when limit is undefined', () => {
  assertEquals(resolveEffectiveLimit({}), 50);
});

Deno.test('resolveEffectiveLimit passes an explicit valid limit through unchanged', () => {
  assertEquals(resolveEffectiveLimit({ limit: 10 }), 10);
});

Deno.test('resolveEffectiveLimit clamps a limit above 50 down to 50', () => {
  assertEquals(resolveEffectiveLimit({ limit: 500 }), 50);
});

Deno.test('resolveEffectiveLimit clamps a limit of exactly 50 unchanged', () => {
  assertEquals(resolveEffectiveLimit({ limit: 50 }), 50);
});

Deno.test('resolveEffectiveLimit clamps a limit of exactly 1 unchanged', () => {
  assertEquals(resolveEffectiveLimit({ limit: 1 }), 1);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for limit 0', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: 0 }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a negative limit', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: -5 }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a non-integer limit', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: 2.5 }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a non-numeric limit', () => {
  assertThrows(
    () => resolveEffectiveLimit({ limit: 'lots' }),
    InvalidLimitError,
  );
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a null limit', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: null }), InvalidLimitError);
});
