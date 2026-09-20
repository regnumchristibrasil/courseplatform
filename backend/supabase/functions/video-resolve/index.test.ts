import { assertEquals, assertExists, assertMatch } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleVideoResolve, type VideoResolveDeps } from './index.ts';
import { createCallerClient } from '../_shared/supabase.ts';
import type {
  CaptureEventInput,
  CaptureExceptionInput,
  CaptureResult,
  PostHogEnv,
} from '../_shared/observability.ts';
import { createVideoProviderRegistry, resolveVideo } from '../_shared/video/registry.ts';
import type { VideoProviderRegistry } from '../_shared/video/registry.ts';
import { PandaProviderNotImplementedError } from '../_shared/video/panda-provider.ts';

const POSTHOG_ENV: PostHogEnv = { apiKey: 'phc_test', host: 'https://us.i.posthog.com' };
const LESSON_ID = 'lesson-uuid-1';
const FUNCTION_URL = 'https://example.com/functions/v1/video-resolve';

interface DbLikeError {
  readonly message: string;
}
interface RpcResponse {
  readonly data: unknown;
  readonly error: DbLikeError | null;
}
interface RpcCall {
  readonly schema: string;
  readonly fn: string;
  readonly args: unknown;
}
interface AuthGetUserResponse {
  readonly data: { readonly user: { readonly id: string } | null };
  readonly error: DbLikeError | null;
}

interface FakeSupabaseOptions {
  readonly rpcResponse?: RpcResponse;
  readonly rpcThrows?: unknown;
  readonly authResponse?: AuthGetUserResponse;
  readonly authThrows?: unknown;
}

function createFakeSupabase(options: FakeSupabaseOptions = {}) {
  const rpcCalls: RpcCall[] = [];
  let getUserCallCount = 0;

  const client = {
    schema(schemaName: string) {
      return {
        rpc(fn: string, args: unknown) {
          rpcCalls.push({ schema: schemaName, fn, args });
          if (options.rpcThrows !== undefined) {
            return Promise.reject(options.rpcThrows);
          }
          return Promise.resolve(options.rpcResponse ?? { data: [], error: null });
        },
      };
    },
    auth: {
      getUser() {
        getUserCallCount += 1;
        if (options.authThrows !== undefined) {
          return Promise.reject(options.authThrows);
        }
        return Promise.resolve(
          options.authResponse ?? { data: { user: null }, error: { message: 'no session' } },
        );
      },
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    rpcCalls,
    getUserCallCount: () => getUserCallCount,
  };
}

function fakeCreateCallerClientFn(client: SupabaseClient): typeof createCallerClient {
  return () => client;
}

function fakeCapture(): {
  fn: (env: PostHogEnv, input: CaptureEventInput) => Promise<CaptureResult>;
  calls: CaptureEventInput[];
} {
  const calls: CaptureEventInput[] = [];
  return {
    calls,
    fn: (_env, input) => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    },
  };
}

function fakeCaptureException(): {
  fn: (env: PostHogEnv, input: CaptureExceptionInput) => Promise<CaptureResult>;
  calls: CaptureExceptionInput[];
} {
  const calls: CaptureExceptionInput[] = [];
  return {
    calls,
    fn: (_env, input) => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    },
  };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = { Authorization: 'Bearer test-jwt' },
): Request {
  return new Request(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function emptyBodyRequest(): Request {
  return new Request(FUNCTION_URL, { method: 'POST', headers: {}, body: '' });
}

function baseDeps(overrides: Partial<VideoResolveDeps> = {}): VideoResolveDeps {
  return {
    postHogEnv: POSTHOG_ENV,
    registry: {} as VideoProviderRegistry,
    ...overrides,
  };
}

Deno.test('handleVideoResolve returns the CORS preflight response for OPTIONS', async () => {
  const request = new Request(FUNCTION_URL, { method: 'OPTIONS' });
  const response = await handleVideoResolve(request, baseDeps());
  assertEquals(response.status, 204);
});

Deno.test('handleVideoResolve rejects non-POST methods with 405', async () => {
  const request = new Request(FUNCTION_URL, { method: 'GET' });
  const response = await handleVideoResolve(request, baseDeps());
  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error.code, 'method_not_allowed');
  assertExists(body.error.requestId);
});

Deno.test('handleVideoResolve returns 400 invalid_body for an empty request body', async () => {
  const response = await handleVideoResolve(emptyBodyRequest(), baseDeps());
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleVideoResolve returns 400 invalid_body for malformed JSON', async () => {
  const request = new Request(FUNCTION_URL, { method: 'POST', body: '{not-json' });
  const response = await handleVideoResolve(request, baseDeps());
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleVideoResolve returns 400 invalid_body when lessonId is missing', async () => {
  const response = await handleVideoResolve(postRequest({}), baseDeps());
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleVideoResolve returns 400 invalid_body when lessonId is not a string', async () => {
  const response = await handleVideoResolve(postRequest({ lessonId: 42 }), baseDeps());
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleVideoResolve returns 400 invalid_body when lessonId is an empty/blank string', async () => {
  const response = await handleVideoResolve(postRequest({ lessonId: '   ' }), baseDeps());
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleVideoResolve returns 401 unauthorized when Authorization header is missing (real createCallerClient)', async () => {
  const request = postRequest({ lessonId: LESSON_ID }, {});
  const response = await handleVideoResolve(
    request,
    baseDeps({ createCallerClientFn: createCallerClient }),
  );
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, 'unauthorized');
});

Deno.test('handleVideoResolve captures video_resolve_failed and returns 500 when the RPC call throws', async () => {
  const { client, rpcCalls } = createFakeSupabase({ rpcThrows: new Error('network exploded') });
  const capture = fakeCapture();
  const captureException = fakeCaptureException();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({
      createCallerClientFn: fakeCreateCallerClientFn(client),
      captureFn: capture.fn,
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, 'internal_error');
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0]?.schema, 'app');
  assertEquals(rpcCalls[0]?.fn, 'get_playable_ref');
  assertEquals(rpcCalls[0]?.args, { p_lesson_id: LESSON_ID });
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.properties?.reason, 'video_resolve_failed');
  assertEquals(capture.calls.length, 0);
});

Deno.test('handleVideoResolve captures video_resolve_failed and returns 500 when the RPC returns a Postgrest error', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: { data: null, error: { message: 'relation does not exist' } },
  });
  const captureException = fakeCaptureException();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({
      createCallerClientFn: fakeCreateCallerClientFn(client),
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 500);
  assertEquals((await response.json()).error.code, 'internal_error');
  assertEquals(captureException.calls.length, 1);
});

Deno.test('handleVideoResolve returns 403 not_entitled and captures video_resolve_denied on zero rows (covers both not-entitled and lesson-missing)', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: { data: [], error: null },
    authResponse: { data: { user: { id: 'user-123' } }, error: null },
  });
  const capture = fakeCapture();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({ createCallerClientFn: fakeCreateCallerClientFn(client), captureFn: capture.fn }),
  );

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, 'not_entitled');
  assertEquals(capture.calls.length, 1);
  assertEquals(capture.calls[0]?.event, 'video_resolve_denied');
  assertEquals(capture.calls[0]?.distinctId, 'user-123');
  assertEquals(capture.calls[0]?.properties?.lessonId, LESSON_ID);
});

Deno.test('handleVideoResolve falls back to the anonymous distinctId on the denial path when auth.getUser fails', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: { data: [], error: null },
    authResponse: { data: { user: null }, error: { message: 'no session' } },
  });
  const capture = fakeCapture();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({ createCallerClientFn: fakeCreateCallerClientFn(client), captureFn: capture.fn }),
  );

  assertEquals(response.status, 403);
  assertEquals(capture.calls[0]?.distinctId, 'anonymous');
});

Deno.test('handleVideoResolve returns 500 internal_error and captures video_resolve_failed for an unrecognized provider value', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: {
      data: [{ lesson_id: LESSON_ID, provider: 'vimeo', external_ref: 'abc123' }],
      error: null,
    },
  });
  const captureException = fakeCaptureException();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({
      createCallerClientFn: fakeCreateCallerClientFn(client),
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 500);
  assertEquals((await response.json()).error.code, 'internal_error');
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.properties?.provider, 'vimeo');
  assertEquals(captureException.calls[0]?.properties?.reason, 'video_resolve_failed');
});

Deno.test('handleVideoResolve returns 500 internal_error and captures video_resolve_failed when resolveVideo throws a generic error', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: {
      data: [{ lesson_id: LESSON_ID, provider: 'youtube', external_ref: 'not-a-valid-id!!' }],
      error: null,
    },
  });
  const captureException = fakeCaptureException();
  const failingResolveVideo: typeof resolveVideo = () => {
    throw new Error('boom');
  };

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({
      createCallerClientFn: fakeCreateCallerClientFn(client),
      resolveVideoFn: failingResolveVideo,
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 500);
  assertEquals((await response.json()).error.code, 'internal_error');
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.properties?.playerKind, 'youtube');
});

Deno.test('handleVideoResolve returns 500 internal_error for a panda row via the REAL registry (proves the stub throw path executes, not special-cased)', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: {
      data: [{ lesson_id: LESSON_ID, provider: 'panda', external_ref: 'panda-ref-1' }],
      error: null,
    },
  });
  const captureException = fakeCaptureException();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({
      registry: createVideoProviderRegistry(),
      createCallerClientFn: fakeCreateCallerClientFn(client),
      // resolveVideoFn intentionally NOT overridden -- exercises the real
      // resolveVideo -> PandaProvider.resolve() throw path end to end.
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 500);
  assertEquals((await response.json()).error.code, 'internal_error');
  assertEquals(captureException.calls.length, 1);
  assertEquals(
    captureException.calls[0]?.error instanceof PandaProviderNotImplementedError,
    true,
  );
});

Deno.test('handleVideoResolve resolves a youtube lesson end to end and captures video_resolved', async () => {
  const { client } = createFakeSupabase({
    rpcResponse: {
      data: [{ lesson_id: LESSON_ID, provider: 'youtube', external_ref: 'dQw4w9WgXcQ' }],
      error: null,
    },
    authResponse: { data: { user: { id: 'user-456' } }, error: null },
  });
  const capture = fakeCapture();

  const response = await handleVideoResolve(
    postRequest({ lessonId: LESSON_ID }),
    baseDeps({
      registry: createVideoProviderRegistry(),
      createCallerClientFn: fakeCreateCallerClientFn(client),
      captureFn: capture.fn,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, {
    lessonId: LESSON_ID,
    video: { playerKind: 'youtube', videoId: 'dQw4w9WgXcQ', expiresAt: null },
  });
  assertEquals(capture.calls.length, 1);
  assertEquals(capture.calls[0]?.event, 'video_resolved');
  assertEquals(capture.calls[0]?.distinctId, 'user-456');
  assertEquals(capture.calls[0]?.properties, { lessonId: LESSON_ID, playerKind: 'youtube' });
});

Deno.test('handleVideoResolve error envelopes always include a requestId', async () => {
  const response = await handleVideoResolve(postRequest({}), baseDeps());
  const body = await response.json();
  assertMatch(
    body.error.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});
