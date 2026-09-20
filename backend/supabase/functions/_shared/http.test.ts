import { assertEquals, assertExists, assertMatch, assertRejects } from '@std/assert';
import {
  BodyParseError,
  CORS_HEADERS,
  corsPreflightResponse,
  errorJsonResponse,
  generateRequestId,
  jsonResponse,
  parseJsonBody,
} from './http.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test('generateRequestId returns a UUID', () => {
  const requestId = generateRequestId();
  assertMatch(requestId, UUID_PATTERN);
});

Deno.test('generateRequestId returns a fresh id on every call', () => {
  assertEquals(generateRequestId() === generateRequestId(), false);
});

Deno.test('jsonResponse sets JSON content-type and default 200 status', async () => {
  const response = jsonResponse({ hello: 'world' });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('Content-Type'), 'application/json');
  assertEquals(await response.json(), { hello: 'world' });
});

Deno.test('jsonResponse honors a custom status and merges extra headers', () => {
  const response = jsonResponse({ ok: true }, { status: 201, headers: { 'X-Test': 'value' } });
  assertEquals(response.status, 201);
  assertEquals(response.headers.get('X-Test'), 'value');
});

Deno.test('jsonResponse always includes CORS headers', () => {
  const response = jsonResponse({ ok: true });
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    assertEquals(response.headers.get(key), value);
  }
});

Deno.test('errorJsonResponse builds the frozen error envelope shape', async () => {
  const response = errorJsonResponse({
    code: 'invalid_input',
    message: 'courseId is required',
    requestId: 'fixed-request-id',
  });
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: {
      code: 'invalid_input',
      message: 'courseId is required',
      requestId: 'fixed-request-id',
    },
  });
});

Deno.test('errorJsonResponse generates a requestId when none is given', async () => {
  const response = errorJsonResponse({ code: 'internal_error', message: 'boom' });
  const body = await response.json();
  assertExists(body.error.requestId);
  assertMatch(body.error.requestId, UUID_PATTERN);
});

Deno.test('errorJsonResponse honors a custom status', () => {
  const response = errorJsonResponse({ code: 'not_found', message: 'no such order', status: 404 });
  assertEquals(response.status, 404);
});

Deno.test('corsPreflightResponse returns a 204 with no body', async () => {
  const response = corsPreflightResponse();
  assertEquals(response.status, 204);
  assertEquals(await response.text(), '');
  assertEquals(
    response.headers.get('Access-Control-Allow-Origin'),
    CORS_HEADERS['Access-Control-Allow-Origin'],
  );
});

Deno.test('parseJsonBody parses a valid JSON request body', async () => {
  const request = new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify({ courseId: 'abc' }),
  });
  const body = await parseJsonBody<{ courseId: string }>(request);
  assertEquals(body, { courseId: 'abc' });
});

Deno.test('parseJsonBody rejects an empty body with BodyParseError', async () => {
  const request = new Request('https://example.com', { method: 'POST', body: '' });
  await assertRejects(() => parseJsonBody(request), BodyParseError, 'empty');
});

Deno.test('parseJsonBody rejects malformed JSON with BodyParseError', async () => {
  const request = new Request('https://example.com', { method: 'POST', body: '{not-json' });
  await assertRejects(() => parseJsonBody(request), BodyParseError, 'not valid JSON');
});
