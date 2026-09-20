import { assertEquals, assertExists } from '@std/assert';
import { captureAndFlush, captureExceptionAndFlush, type PostHogEnv } from './observability.ts';

const ENV: PostHogEnv = { apiKey: 'phc_test_key', host: 'https://us.i.posthog.com' };

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(response: Response) {
  const calls: CapturedRequest[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(response);
  };
  return { fn, calls };
}

Deno.test('captureAndFlush POSTs to the PostHog capture endpoint and awaits the response', async () => {
  const { fn, calls } = fakeFetch(new Response('{}', { status: 200 }));
  const result = await captureAndFlush(
    ENV,
    { event: 'payment_confirmed', distinctId: 'order-123', properties: { amountCents: 1000 } },
    fn,
  );
  assertEquals(result.ok, true);
  assertEquals(calls.length, 1);
  const call = calls[0];
  assertExists(call);
  assertEquals(call.url, `${ENV.host}/capture/`);
  assertEquals(call.init.method, 'POST');
  const body = JSON.parse(String(call.init.body));
  assertEquals(body.api_key, ENV.apiKey);
  assertEquals(body.event, 'payment_confirmed');
  assertEquals(body.distinct_id, 'order-123');
  assertEquals(body.properties.amountCents, 1000);
  assertExists(body.timestamp);
});

Deno.test('captureAndFlush returns ok:false (never throws) on a non-2xx PostHog response', async () => {
  const { fn } = fakeFetch(new Response('server error', { status: 500 }));
  const result = await captureAndFlush(ENV, { event: 'reconcile_tick', distinctId: 'cron' }, fn);
  assertEquals(result.ok, false);
});

Deno.test('captureAndFlush returns ok:false (never throws) when the network request itself fails', async () => {
  const failingFetch = () => Promise.reject(new Error('network down'));
  const result = await captureAndFlush(
    ENV,
    { event: 'reconcile_tick', distinctId: 'cron' },
    failingFetch,
  );
  assertEquals(result.ok, false);
  assertExists(result.error);
});

Deno.test('captureAndFlush has no separate flush step -- awaiting the call is the whole contract', async () => {
  // Regression guard for the "obvious, hard-to-skip" API requirement: the
  // promise returned by captureAndFlush must not resolve before the fetch
  // call it made has itself resolved.
  let fetchResolved = false;
  const trackedFetch = async (_input: string | URL | Request, _init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fetchResolved = true;
    return new Response('{}', { status: 200 });
  };
  await captureAndFlush(ENV, { event: 'reconcile_tick', distinctId: 'cron' }, trackedFetch);
  assertEquals(fetchResolved, true);
});

Deno.test('captureExceptionAndFlush captures an Error with message and stack', async () => {
  const { fn, calls } = fakeFetch(new Response('{}', { status: 200 }));
  await captureExceptionAndFlush(
    ENV,
    { distinctId: 'order-123', error: new Error('boom') },
    fn,
  );
  const call = calls[0];
  assertExists(call);
  const body = JSON.parse(String(call.init.body));
  assertEquals(body.event, '$exception');
  assertEquals(body.properties.message, 'boom');
  assertExists(body.properties.stack);
});

Deno.test('captureExceptionAndFlush handles a non-Error thrown value', async () => {
  const { fn, calls } = fakeFetch(new Response('{}', { status: 200 }));
  await captureExceptionAndFlush(ENV, { distinctId: 'order-123', error: 'plain string error' }, fn);
  const call = calls[0];
  assertExists(call);
  const body = JSON.parse(String(call.init.body));
  assertEquals(body.properties.message, 'plain string error');
});
