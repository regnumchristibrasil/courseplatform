import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { ResendApiError, sendEmail } from './resend-client.ts';
import type { SendEmailInput } from './resend-client.ts';

const API_KEY = 'resend-test-api-key';
const FROM_EMAIL = 'no-reply@example.com';
const REPLY_TO = 'support@example.com';

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(response: Response | ((req: CapturedRequest) => Response)) {
  const calls: CapturedRequest[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const res = typeof response === 'function' ? response(call) : response;
    return Promise.resolve(res);
  };
  return { fn, calls };
}

function sampleInput(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    to: 'buyer@example.com',
    subject: 'Assunto de teste',
    html: '<p>Corpo de teste</p>',
    ...overrides,
  };
}

Deno.test('sendEmail POSTs to the Resend API with Bearer auth and the mapped body', async () => {
  const { fn, calls } = fakeFetch(
    new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 }),
  );

  const result = await sendEmail(
    { apiKey: API_KEY, fromEmail: FROM_EMAIL, replyTo: REPLY_TO, fetchFn: fn },
    sampleInput(),
  );

  assertEquals(calls.length, 1);
  const call = calls[0];
  assertExists(call);
  assertEquals(call.url, 'https://api.resend.com/emails');
  assertEquals(call.init.method, 'POST');

  const headers = new Headers(call.init.headers);
  assertEquals(headers.get('Authorization'), `Bearer ${API_KEY}`);
  assertEquals(headers.get('Content-Type'), 'application/json');

  const body = JSON.parse(String(call.init.body));
  assertEquals(body.from, FROM_EMAIL);
  assertEquals(body.to, 'buyer@example.com');
  assertEquals(body.subject, 'Assunto de teste');
  assertEquals(body.html, '<p>Corpo de teste</p>');
  assertEquals(body.reply_to, REPLY_TO);

  assertEquals(result.id, 'resend-msg-1');
});

Deno.test('sendEmail throws ResendApiError on a non-OK response with a JSON error body', async () => {
  const { fn } = fakeFetch(
    new Response(JSON.stringify({ message: 'invalid API key' }), { status: 401 }),
  );

  const error = await assertRejects(
    () =>
      sendEmail(
        { apiKey: 'bad-key', fromEmail: FROM_EMAIL, replyTo: REPLY_TO, fetchFn: fn },
        sampleInput(),
      ),
    ResendApiError,
  ) as ResendApiError;

  assertEquals(error.status, 401);
  assertEquals((error.body as { message: string }).message, 'invalid API key');
});

Deno.test('sendEmail throws ResendApiError on a non-OK response with a malformed (non-JSON) body', async () => {
  const { fn } = fakeFetch(new Response('<html>Internal Server Error</html>', { status: 500 }));

  const error = await assertRejects(
    () =>
      sendEmail(
        { apiKey: API_KEY, fromEmail: FROM_EMAIL, replyTo: REPLY_TO, fetchFn: fn },
        sampleInput(),
      ),
    ResendApiError,
  ) as ResendApiError;

  assertEquals(error.status, 500);
});

Deno.test('sendEmail throws ResendApiError when a 2xx response has a malformed (non-JSON) body', async () => {
  const { fn } = fakeFetch(new Response('not json', { status: 200 }));

  await assertRejects(
    () =>
      sendEmail(
        { apiKey: API_KEY, fromEmail: FROM_EMAIL, replyTo: REPLY_TO, fetchFn: fn },
        sampleInput(),
      ),
    ResendApiError,
  );
});

Deno.test('sendEmail throws ResendApiError when a 2xx response is missing a string "id" field', async () => {
  const { fn } = fakeFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  const error = await assertRejects(
    () =>
      sendEmail(
        { apiKey: API_KEY, fromEmail: FROM_EMAIL, replyTo: REPLY_TO, fetchFn: fn },
        sampleInput(),
      ),
    ResendApiError,
  ) as ResendApiError;

  assertEquals(error.status, 200);
});

Deno.test('sendEmail throws ResendApiError when the 2xx response body is empty', async () => {
  const { fn } = fakeFetch(new Response('', { status: 200 }));

  const error = await assertRejects(
    () =>
      sendEmail(
        { apiKey: API_KEY, fromEmail: FROM_EMAIL, replyTo: REPLY_TO, fetchFn: fn },
        sampleInput(),
      ),
    ResendApiError,
  ) as ResendApiError;

  assertEquals(error.status, 200);
  assertEquals(error.body, null);
});

Deno.test('sendEmail falls back to the real global fetch when fetchFn is not injected', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: string | undefined;
  // deno-lint-ignore require-await
  globalThis.fetch = async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ id: 'resend-msg-default-fetch' }), { status: 200 });
  };

  try {
    const result = await sendEmail(
      { apiKey: API_KEY, fromEmail: FROM_EMAIL, replyTo: REPLY_TO },
      sampleInput(),
    );
    assertEquals(capturedUrl, 'https://api.resend.com/emails');
    assertEquals(result.id, 'resend-msg-default-fetch');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
