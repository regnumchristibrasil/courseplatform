import { assertEquals, assertThrows } from '@std/assert';
import { InvalidLimitError, resolveEffectiveLimit } from './body.ts';

Deno.test('resolveEffectiveLimit defaults to 100 when limit is absent', () => {
  assertEquals(resolveEffectiveLimit({}), 100);
});

Deno.test('resolveEffectiveLimit passes through a valid explicit limit', () => {
  assertEquals(resolveEffectiveLimit({ limit: 25 }), 25);
});

Deno.test('resolveEffectiveLimit clamps a limit above 100 down to 100', () => {
  assertEquals(resolveEffectiveLimit({ limit: 500 }), 100);
});

Deno.test('resolveEffectiveLimit clamps a limit of exactly 100 to 100', () => {
  assertEquals(resolveEffectiveLimit({ limit: 100 }), 100);
});

Deno.test('resolveEffectiveLimit clamps a limit of exactly 1 to 1', () => {
  assertEquals(resolveEffectiveLimit({ limit: 1 }), 1);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for zero', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: 0 }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a negative number', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: -5 }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a non-integer number', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: 2.5 }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for a non-numeric string', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: '50' }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for null', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: null }), InvalidLimitError);
});

Deno.test('resolveEffectiveLimit throws InvalidLimitError for NaN', () => {
  assertThrows(() => resolveEffectiveLimit({ limit: NaN }), InvalidLimitError);
});
