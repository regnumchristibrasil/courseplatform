// video-resolve Edge Function -- resolves a single lesson's playable video
// reference for the calling, entitled user (`POST { lessonId }`).
//
// Security-critical: this function must run under the CALLER's own JWT, not
// a broad service_role client -- see prompt_course_platform.md ("Video
// playback") and supabase/migrations/20260826181011_a11_get_playable_ref.sql.
// `app.get_playable_ref` checks `app.has_active_enrollment(auth.uid(), ...)`
// internally; `auth.uid()` only resolves correctly when the request reaches
// PostgREST/Postgres carrying the caller's own JWT, which is exactly what
// `createCallerClient(request)` does. Using `createServiceRoleClient()` here
// would silently break the entitlement check instead of failing loudly --
// never do that in this file.
//
// `app.get_playable_ref` deliberately returns ZERO ROWS, never a Postgrest
// error, for both "lesson doesn't exist" and "caller isn't entitled" -- to
// avoid leaking curriculum existence to an unauthorized caller. This
// function preserves that property: the same response (403 `not_entitled`)
// is returned for both cases, never a different one.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlayerKind, ResolvedVideo } from '../../../contracts/video.ts';
import { type EnvSource, loadBackendConfig } from '../_shared/config.ts';
import {
  BodyParseError,
  corsPreflightResponse,
  errorJsonResponse,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts';
import {
  captureAndFlush,
  captureExceptionAndFlush,
  type PostHogEnv,
} from '../_shared/observability.ts';
import { createCallerClient, MissingAuthorizationError } from '../_shared/supabase.ts';
import {
  createVideoProviderRegistry,
  resolveVideo,
  type VideoProviderRegistry,
} from '../_shared/video/registry.ts';
import { isPlayerKind } from '../_shared/video/types.ts';

// No real user id is available on paths that fail before (or without) a
// successful `auth.getUser()` round trip -- see the "distinctId" judgment
// call documented in the handoff notes for this task. Used for every
// `video_resolve_failed` capture (data-integrity/exception paths, where
// per-user attribution isn't the point) and as the fallback when
// `auth.getUser()` itself fails on the paths that do attempt it.
const ANONYMOUS_DISTINCT_ID = 'anonymous';

interface VideoResolveRequestBody {
  readonly lessonId?: unknown;
}

// Shape of a row from `app.get_playable_ref` -- `provider` is a raw `text`
// column value (untrusted-shape input from the DB), not yet narrowed to
// `PlayerKind`.
interface PlayableRefRow {
  readonly lesson_id: string;
  readonly provider: string;
  readonly external_ref: string;
}

export interface VideoResolveDeps {
  readonly postHogEnv: PostHogEnv;
  readonly registry: VideoProviderRegistry;
  readonly env?: EnvSource;
  // Every collaborator below is injectable for tests; each defaults to the
  // real implementation, matching this repo's DI-testable-handler
  // convention (see `_shared/payments/confirm-order.ts`).
  readonly createCallerClientFn?: typeof createCallerClient;
  readonly resolveVideoFn?: typeof resolveVideo;
  readonly captureFn?: typeof captureAndFlush;
  readonly captureExceptionFn?: typeof captureExceptionAndFlush;
}

function invalidBodyResponse(message: string): Response {
  return errorJsonResponse({ code: 'invalid_body', message, status: 400 });
}

function internalErrorResponse(): Response {
  return errorJsonResponse({
    code: 'internal_error',
    message: 'Failed to resolve video',
    status: 500,
  });
}

// Same response for "lesson missing" and "not entitled" -- 403, never 404
// (a 404 could imply "route not found", a different HTTP-semantic thing).
function notEntitledResponse(): Response {
  return errorJsonResponse({
    code: 'not_entitled',
    message: 'You are not entitled to view this lesson',
    status: 403,
  });
}

// Best-effort distinct id for PostHog attribution -- an extra `auth.getUser()`
// round trip on top of the RPC call, spent only on paths where a real user
// id materially improves the captured event (the denial and success paths).
// Never throws; falls back to the anonymous placeholder on any failure.
async function resolveDistinctId(supabase: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return ANONYMOUS_DISTINCT_ID;
    }
    return data.user.id;
  } catch {
    return ANONYMOUS_DISTINCT_ID;
  }
}

export async function handleVideoResolve(
  request: Request,
  deps: VideoResolveDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsPreflightResponse();
  }
  if (request.method !== 'POST') {
    return errorJsonResponse({
      code: 'method_not_allowed',
      message: `Method ${request.method} is not allowed`,
      status: 405,
    });
  }

  const createCallerClientFn = deps.createCallerClientFn ?? createCallerClient;
  const resolveVideoFn = deps.resolveVideoFn ?? resolveVideo;
  const capture = deps.captureFn ?? captureAndFlush;
  const captureException = deps.captureExceptionFn ?? captureExceptionAndFlush;

  let body: VideoResolveRequestBody;
  try {
    body = await parseJsonBody<VideoResolveRequestBody>(request);
  } catch (error) {
    if (error instanceof BodyParseError) {
      return invalidBodyResponse(error.message);
    }
    throw error;
  }

  const lessonId = body.lessonId;
  if (typeof lessonId !== 'string' || lessonId.trim().length === 0) {
    return invalidBodyResponse('lessonId is required and must be a non-empty string');
  }

  let supabase: SupabaseClient;
  try {
    supabase = createCallerClientFn(request, deps.env);
  } catch (error) {
    if (error instanceof MissingAuthorizationError) {
      return errorJsonResponse({
        code: 'unauthorized',
        message: 'Missing Authorization header',
        status: 401,
      });
    }
    throw error;
  }

  let data: unknown;
  let rpcErrorMessage: string | null = null;
  try {
    const result = await supabase
      .schema('app')
      .rpc('get_playable_ref', { p_lesson_id: lessonId });
    data = result.data;
    rpcErrorMessage = result.error ? result.error.message : null;
  } catch (error) {
    rpcErrorMessage = error instanceof Error ? error.message : String(error);
  }

  if (rpcErrorMessage !== null) {
    await captureException(deps.postHogEnv, {
      distinctId: ANONYMOUS_DISTINCT_ID,
      error: new Error(`app.get_playable_ref RPC failed: ${rpcErrorMessage}`),
      properties: { reason: 'video_resolve_failed', lessonId },
    });
    return internalErrorResponse();
  }

  const rows = (data ?? []) as readonly PlayableRefRow[];
  const row = rows[0];

  if (!row) {
    const distinctId = await resolveDistinctId(supabase);
    await capture(deps.postHogEnv, {
      event: 'video_resolve_denied',
      distinctId,
      properties: { lessonId },
    });
    return notEntitledResponse();
  }

  if (!isPlayerKind(row.provider)) {
    // Postgres has a row whose provider value this function's video-provider
    // registry doesn't recognize -- a data-integrity bug, not a client
    // error. Capture richly (the raw value is not PII) and fail loudly.
    await captureException(deps.postHogEnv, {
      distinctId: ANONYMOUS_DISTINCT_ID,
      error: new Error(
        `app_private.lesson_assets has an unrecognized provider value: "${row.provider}"`,
      ),
      properties: { reason: 'video_resolve_failed', lessonId, provider: row.provider },
    });
    return internalErrorResponse();
  }

  const playerKind: PlayerKind = row.provider;

  let video: ResolvedVideo;
  try {
    video = await resolveVideoFn(deps.registry, playerKind, row.external_ref);
  } catch (error) {
    // Covers both a genuine provider failure (e.g. a malformed YouTube ref)
    // and the deliberate Panda stub (`PandaProviderNotImplementedError`) --
    // never special-cased, both are "resolution failed" from this
    // function's point of view.
    await captureException(deps.postHogEnv, {
      distinctId: ANONYMOUS_DISTINCT_ID,
      error,
      properties: { reason: 'video_resolve_failed', lessonId, playerKind },
    });
    return internalErrorResponse();
  }

  const distinctId = await resolveDistinctId(supabase);
  await capture(deps.postHogEnv, {
    event: 'video_resolved',
    distinctId,
    properties: { lessonId, playerKind },
  });

  return jsonResponse({ lessonId, video });
}

// Real wiring only runs when this module is the process entry point (i.e.
// deployed/served directly), never on import -- keeps `deno test` from
// paying `loadBackendConfig()`'s fail-fast env validation just to import
// `handleVideoResolve` for testing.
if (import.meta.main) {
  const config = loadBackendConfig();
  const registry = createVideoProviderRegistry();
  Deno.serve((request) => handleVideoResolve(request, { postHogEnv: config.postHog, registry }));
}
