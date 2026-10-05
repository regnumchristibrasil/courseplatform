// Server-side PostHog wrapper for Edge Functions.
//
// Critical constraint: a serverless isolate can be frozen or torn down the
// instant a handler returns, so any design based on "buffer events, flush
// later" risks silently losing them. There is deliberately no queue and no
// separate `flush()` call to remember -- `captureAndFlush` performs the
// HTTP request and awaits its completion (or failure) before resolving.
// Awaiting `captureAndFlush` *is* the flush; there's nothing else to do.
//
// Never throws on delivery failure -- observability must not take down
// business logic. Failures are reported via `CaptureResult.ok` so the
// caller can log them (and `app_private.payment_events` remains the
// durable source of truth for payment failures, per the spec).

const CAPTURE_PATH = '/capture/';
const EXCEPTION_EVENT_NAME = '$exception';

// Frozen server-side event names (prompt_course_platform.md, "PostHog event
// names"). Typing `event` against this union catches typos at compile time.
export type ServerEventName =
  | 'payment_charge_created'
  | 'payment_webhook_received'
  | 'payment_confirmed'
  | 'payment_amount_mismatch'
  | 'payment_webhook_failed'
  | 'video_resolved'
  | 'video_resolve_denied'
  | 'admin_user_status_changed'
  | 'admin_user_status_sync_failed'
  | 'admin_action_denied'
  | 'email_sent'
  | 'email_dead_lettered'
  | 'reconcile_tick';

export interface PostHogEnv {
  readonly apiKey: string;
  readonly host: string;
}

// `$exception` is PostHog's own reserved event name (used by
// `captureExceptionAndFlush` below) -- not part of the frozen
// `ServerEventName` list, but a legitimate value for the `event` field.
export type CaptureEventName = ServerEventName | typeof EXCEPTION_EVENT_NAME;

export interface CaptureEventInput {
  readonly event: CaptureEventName;
  readonly distinctId: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface CaptureExceptionInput {
  readonly distinctId: string;
  readonly error: unknown;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface CaptureResult {
  readonly ok: boolean;
  readonly error?: unknown;
}

export type FetchFn = typeof fetch;

export async function captureAndFlush(
  env: PostHogEnv,
  input: CaptureEventInput,
  fetchFn: FetchFn = fetch,
): Promise<CaptureResult> {
  try {
    const response = await fetchFn(`${env.host}${CAPTURE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.apiKey,
        event: input.event,
        distinct_id: input.distinctId,
        properties: input.properties ?? {},
        timestamp: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      return { ok: false, error: `PostHog capture failed with status ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

// Convenience wrapper for server-side error tracking (payment webhook
// failures, video-resolution failures) -- same flush-is-mandatory contract
// as `captureAndFlush`.
export async function captureExceptionAndFlush(
  env: PostHogEnv,
  input: CaptureExceptionInput,
  fetchFn: FetchFn = fetch,
): Promise<CaptureResult> {
  const { message, stack } = describeError(input.error);
  return await captureAndFlush(
    env,
    {
      event: EXCEPTION_EVENT_NAME,
      distinctId: input.distinctId,
      properties: { ...input.properties, message, stack },
    },
    fetchFn,
  );
}
