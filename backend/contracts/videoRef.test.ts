import { assertEquals } from '@std/assert';
import { parseVideoRef, VIDEO_REF_CASES } from './videoRef.ts';

for (const { input, expected } of VIDEO_REF_CASES) {
  Deno.test(`parseVideoRef(${JSON.stringify(input)})`, () => {
    assertEquals(parseVideoRef(input), expected);
  });
}

Deno.test('VIDEO_REF_CASES covers both providers and rejections', () => {
  const providers = new Set(VIDEO_REF_CASES.map((c) => c.expected?.provider ?? 'none'));
  assertEquals(providers, new Set(['youtube', 'panda', 'none']));
});
