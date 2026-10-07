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

const encoder = new TextEncoder();

interface TrackedStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly state: { pulled: number; cancelled: boolean };
}

function trackedStream(chunks: readonly Uint8Array[]): TrackedStream {
  const state = { pulled: 0, cancelled: false };
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      state.pulled += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function streamRequest(stream: ReadableStream<Uint8Array>, headers: HeadersInit = {}): Request {
  return new Request('https://example.com', {
    method: 'POST',
    body: stream,
    headers,
    // @ts-ignore: duplex is required by fetch for streamed bodies
    duplex: 'half',
  });
}

Deno.test('parseJsonBody cancels a chunked stream as soon as maxBytes is exceeded', async () => {
  const chunks = Array.from({ length: 50 }, () => encoder.encode('x'.repeat(100)));
  const { stream, state } = trackedStream(chunks);
  await assertRejects(
    () => parseJsonBody(streamRequest(stream), { maxBytes: 250 }),
    BodyParseError,
    'too large',
  );
  assertEquals(state.cancelled, true);
  assertEquals(state.pulled < chunks.length, true);
});

Deno.test('parseJsonBody rejects an oversized body without Content-Length', async () => {
  const { stream } = trackedStream([encoder.encode('{"a":"' + 'x'.repeat(300) + '"}')]);
  await assertRejects(
    () => parseJsonBody(streamRequest(stream), { maxBytes: 100 }),
    BodyParseError,
    'too large',
  );
});

Deno.test('parseJsonBody rejects early when Content-Length is over the cap', async () => {
  const { stream, state } = trackedStream([encoder.encode('{}')]);
  await assertRejects(
    () => parseJsonBody(streamRequest(stream, { 'Content-Length': '5000' }), { maxBytes: 100 }),
    BodyParseError,
    'too large',
  );
  assertEquals(state.pulled, 0);
});

Deno.test('parseJsonBody accepts a body of exactly maxBytes', async () => {
  const raw = '{"a":"' + 'x'.repeat(10) + '"}';
  const bytes = encoder.encode(raw);
  const request = new Request('https://example.com', { method: 'POST', body: bytes });
  assertEquals(await parseJsonBody(request, { maxBytes: bytes.byteLength }), {
    a: 'x'.repeat(10),
  });
  const { stream } = trackedStream([bytes]);
  assertEquals(await parseJsonBody(streamRequest(stream), { maxBytes: bytes.byteLength }), {
    a: 'x'.repeat(10),
  });
});

Deno.test('parseJsonBody rejects maxBytes + 1', async () => {
  const bytes = encoder.encode('{"a":"' + 'x'.repeat(10) + '"}');
  const { stream } = trackedStream([bytes]);
  await assertRejects(
    () => parseJsonBody(streamRequest(stream), { maxBytes: bytes.byteLength - 1 }),
    BodyParseError,
    'too large',
  );
});

Deno.test('parseJsonBody leaves small bodies unaffected under a cap', async () => {
  const request = new Request('https://example.com', {
    method: 'POST',
    body: JSON.stringify({ ok: true }),
  });
  assertEquals(await parseJsonBody(request, { maxBytes: 4096 }), { ok: true });
});

Deno.test('parseJsonBody decodes multi-byte UTF-8 split across chunks', async () => {
  const bytes = encoder.encode('{"name":"aç\u{1F600}b"}');
  const emojiStart = bytes.indexOf(0xf0);
  const { stream } = trackedStream([
    bytes.slice(0, emojiStart + 2),
    bytes.slice(emojiStart + 2),
  ]);
  assertEquals(await parseJsonBody(streamRequest(stream), { maxBytes: 4096 }), {
    name: 'aç\u{1F600}b',
  });
});

Deno.test('parseJsonBody counts bytes, not characters, against maxBytes', async () => {
  const raw = '{"a":"' + 'ç'.repeat(10) + '"}';
  const { stream } = trackedStream([encoder.encode(raw)]);
  await assertRejects(
    () => parseJsonBody(streamRequest(stream), { maxBytes: raw.length }),
    BodyParseError,
    'too large',
  );
});
