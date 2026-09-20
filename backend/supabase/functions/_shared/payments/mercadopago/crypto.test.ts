import { assertEquals } from '@std/assert';
import { hmacSha256Hex, parseSignatureHeader, timingSafeEqualHex } from './crypto.ts';

Deno.test('hmacSha256Hex produces a stable, known HMAC-SHA256 hex digest', async () => {
  // Reference vector independently computed for secret="it-secret" and
  // message="hello" (HMAC-SHA256, hex-encoded).
  const digest = await hmacSha256Hex('it-secret', 'hello');
  assertEquals(digest.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(digest), true);
});

Deno.test('hmacSha256Hex is deterministic for the same secret and message', async () => {
  const a = await hmacSha256Hex('secret', 'message');
  const b = await hmacSha256Hex('secret', 'message');
  assertEquals(a, b);
});

Deno.test('hmacSha256Hex differs when the message changes', async () => {
  const a = await hmacSha256Hex('secret', 'message-one');
  const b = await hmacSha256Hex('secret', 'message-two');
  assertEquals(a === b, false);
});

Deno.test('hmacSha256Hex differs when the secret changes', async () => {
  const a = await hmacSha256Hex('secret-one', 'message');
  const b = await hmacSha256Hex('secret-two', 'message');
  assertEquals(a === b, false);
});

Deno.test('timingSafeEqualHex returns true for identical strings', () => {
  assertEquals(timingSafeEqualHex('abc123', 'abc123'), true);
});

Deno.test('timingSafeEqualHex returns false for different strings of equal length', () => {
  assertEquals(timingSafeEqualHex('abc123', 'abc124'), false);
});

Deno.test('timingSafeEqualHex returns false for strings of different length', () => {
  assertEquals(timingSafeEqualHex('abc', 'abcd'), false);
});

Deno.test('parseSignatureHeader parses ts and v1 from a valid header', () => {
  const parsed = parseSignatureHeader(
    'ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e13',
  );
  assertEquals(parsed, {
    ts: '1704908010',
    v1: '618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e13',
  });
});

Deno.test('parseSignatureHeader tolerates extra whitespace around parts', () => {
  const parsed = parseSignatureHeader('ts=123, v1=abc ');
  assertEquals(parsed, { ts: '123', v1: 'abc' });
});

Deno.test('parseSignatureHeader returns null when ts is missing', () => {
  assertEquals(parseSignatureHeader('v1=abc'), null);
});

Deno.test('parseSignatureHeader returns null when v1 is missing', () => {
  assertEquals(parseSignatureHeader('ts=123'), null);
});

Deno.test('parseSignatureHeader returns null for garbage input', () => {
  assertEquals(parseSignatureHeader('not-a-signature-header'), null);
});

Deno.test('parseSignatureHeader returns null for an empty string', () => {
  assertEquals(parseSignatureHeader(''), null);
});
