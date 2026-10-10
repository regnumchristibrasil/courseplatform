import { assert, assertEquals, assertFalse } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureEventInput, CaptureResult } from '../_shared/observability.ts';
import { MissingAuthorizationError } from '../_shared/supabase.ts';
import { type AdminCoursesDeps, handleAdminCourses } from './index.ts';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const UPDATED_AT = '2026-10-09T22:35:59.123456+00:00';
const NEW_UPDATED_AT = '2026-10-09T23:00:00.654321+00:00';
const TITLE_SECRET = 'Titulo Secreto do Curso';
const JWT = 'jwt-super-secret-token';

interface Options {
  readonly rpc?: { data: unknown; error: { message?: string; code?: string } | null };
  readonly rpcThrows?: unknown;
  readonly user?: { id: string } | null;
  readonly missingAuth?: boolean;
  readonly captureThrows?: boolean;
}

const saved = (over: Record<string, unknown> = {}) => ({
  data: [{
    id: COURSE_ID,
    updated_at: NEW_UPDATED_AT,
    price_changed: false,
    access_duration_changed: false,
    previous_price_cents: 10000,
    previous_access_duration_days: 30,
    ...over,
  }],
  error: null,
});

function setup(o: Options = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown>; schema: string }[] = [];
  const captures: CaptureEventInput[] = [];
  const logs: string[] = [];
  const caller = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: o.user === undefined ? { id: ACTOR_ID } : o.user },
          error: null,
        }),
    },
    schema: (schema: string) => ({
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args, schema });
        if (o.rpcThrows !== undefined) return Promise.reject(o.rpcThrows);
        return Promise.resolve(o.rpc ?? saved());
      },
    }),
  } as unknown as SupabaseClient;
  const deps: AdminCoursesDeps = {
    postHogEnv: { apiKey: 'phc_test', host: 'https://us.i.posthog.com' },
    createCallerClientFn: () => {
      if (o.missingAuth) throw new MissingAuthorizationError();
      return caller;
    },
    captureFn: (_env, input): Promise<CaptureResult> => {
      if (o.captureThrows) return Promise.reject(new Error('posthog down'));
      captures.push(input);
      return Promise.resolve({ ok: true });
    },
    logFn: (line) => logs.push(line),
  };
  return { deps, rpcCalls, captures, logs };
}

const fields = { title: TITLE_SECRET, description: 'x', priceCents: 15000, accessDurationDays: 60 };
const updateBody = {
  action: 'update',
  courseId: COURSE_ID,
  expectedUpdatedAt: UPDATED_AT,
  ...fields,
};
const request = (
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${JWT}` },
) =>
  new Request('https://example.com/functions/v1/admin-courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return (await response.json()).error;
}

Deno.test('rejects non-POST and answers CORS preflight', async () => {
  const { deps } = setup();
  assertEquals(
    (await handleAdminCourses(new Request('https://x.test', { method: 'GET' }), deps)).status,
    405,
  );
  assertEquals(
    (await handleAdminCourses(new Request('https://x.test', { method: 'OPTIONS' }), deps)).status,
    204,
  );
});

Deno.test('401 without credentials, and no RPC is called', async () => {
  const missing = setup({ missingAuth: true });
  assertEquals((await handleAdminCourses(request(updateBody), missing.deps)).status, 401);
  const noUser = setup({ user: null });
  assertEquals((await handleAdminCourses(request(updateBody), noUser.deps)).status, 401);
  assertEquals(missing.rpcCalls.length + noUser.rpcCalls.length, 0);
});

Deno.test('400 on invalid body without touching the database', async () => {
  const { deps, rpcCalls } = setup();
  const response = await handleAdminCourses(request({ ...updateBody, actorId: ACTOR_ID }), deps);
  assertEquals(response.status, 400);
  assertEquals((await errorOf(response)).code, 'invalid_input');
  assertEquals(rpcCalls.length, 0);
});

Deno.test('update calls the RPC with the caller client and the typed arguments', async () => {
  const { deps, rpcCalls } = setup();
  const response = await handleAdminCourses(request(updateBody), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { courseId: COURSE_ID, updatedAt: NEW_UPDATED_AT });
  assertEquals(rpcCalls, [{
    schema: 'app',
    fn: 'staff_update_course',
    args: {
      p_course_id: COURSE_ID,
      p_expected_updated_at: UPDATED_AT,
      p_title: TITLE_SECRET,
      p_description: 'x',
      p_price_cents: 15000,
      p_access_duration_days: 60,
    },
  }]);
});

Deno.test('create calls staff_create_course', async () => {
  const { deps, rpcCalls } = setup({
    rpc: { data: [{ id: COURSE_ID, updated_at: NEW_UPDATED_AT }], error: null },
  });
  const response = await handleAdminCourses(request({ action: 'create', ...fields }), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { courseId: COURSE_ID, updatedAt: NEW_UPDATED_AT });
  assertEquals(rpcCalls[0]?.fn, 'staff_create_course');
  assertEquals(Object.keys(rpcCalls[0]!.args).sort(), [
    'p_access_duration_days',
    'p_description',
    'p_price_cents',
    'p_title',
  ]);
});

Deno.test('price and duration changes emit sanitized events (no title, no description)', async () => {
  const { deps, captures } = setup({
    rpc: saved({ price_changed: true, access_duration_changed: true }),
  });
  await handleAdminCourses(request(updateBody), deps);
  assertEquals(captures.map((c) => c.event).sort(), [
    'admin_course_duration_changed',
    'admin_course_price_changed',
  ]);
  const price = captures.find((c) => c.event === 'admin_course_price_changed')!;
  assertEquals(price.distinctId, ACTOR_ID);
  assertEquals(price.properties?.course_id, COURSE_ID);
  assertEquals(price.properties?.old_price_cents, 10000);
  assertEquals(price.properties?.new_price_cents, 15000);
  const serialized = JSON.stringify(captures);
  assertFalse(serialized.includes(TITLE_SECRET));
  assertFalse(serialized.includes(JWT));
});

Deno.test('no event when neither sensitive field changed', async () => {
  const { deps, captures } = setup();
  await handleAdminCourses(request(updateBody), deps);
  assertEquals(captures.length, 0);
});

Deno.test('denied actions map to the stable code and emit admin_action_denied', async () => {
  const cases = [['forbidden', 403], ['stale_target', 409], ['not_found', 404], [
    'invalid_input',
    400,
  ]] as const;
  for (const [code, status] of cases) {
    const { deps, captures } = setup({ rpc: { data: null, error: { message: code } } });
    const response = await handleAdminCourses(request(updateBody), deps);
    assertEquals(response.status, status);
    assertEquals((await errorOf(response)).code, code);
    assertEquals(captures[0]?.event, 'admin_action_denied');
    assertEquals(captures[0]?.properties?.error_code, code);
    assertEquals(captures[0]?.properties?.course_action, 'update');
    assertFalse(JSON.stringify(captures).includes(TITLE_SECRET));
  }
});

Deno.test('unknown RPC error is 500 internal_error with only safe metadata logged', async () => {
  const { deps, captures, logs } = setup({
    rpc: { data: null, error: { message: `leak ${TITLE_SECRET}`, code: '23505' } },
  });
  const response = await handleAdminCourses(request(updateBody), deps);
  assertEquals(response.status, 500);
  assertEquals((await errorOf(response)).code, 'internal_error');
  assertEquals(captures[0]?.event, '$exception');
  assertFalse(logs.join('\n').includes(TITLE_SECRET));
  assertFalse(JSON.stringify(captures).includes(TITLE_SECRET));
});

Deno.test('a thrown RPC and an empty result are 500', async () => {
  const thrown = setup({ rpcThrows: new Error('network') });
  assertEquals((await handleAdminCourses(request(updateBody), thrown.deps)).status, 500);
  const empty = setup({ rpc: { data: [], error: null } });
  assertEquals((await handleAdminCourses(request(updateBody), empty.deps)).status, 500);
});

Deno.test('analytics failure never fails the request', async () => {
  const { deps } = setup({ rpc: saved({ price_changed: true }), captureThrows: true });
  const response = await handleAdminCourses(request(updateBody), deps);
  assertEquals(response.status, 200);
});

Deno.test('response is JSON and carries no secrets', async () => {
  const { deps } = setup();
  const response = await handleAdminCourses(request(updateBody), deps);
  assert(response.headers.get('Content-Type')?.includes('application/json'));
  assertFalse((await response.text()).includes(JWT));
});

const LESSON_ID = '33333333-3333-4333-8333-333333333333';
const statusBody = {
  action: 'set_status',
  courseId: COURSE_ID,
  expectedUpdatedAt: UPDATED_AT,
  status: 'published',
};
const deleteBody = { action: 'delete', courseId: COURSE_ID, expectedUpdatedAt: UPDATED_AT };

Deno.test('set_status calls staff_set_course_status and emits a sanitized status event', async () => {
  const { deps, rpcCalls, captures } = setup({
    rpc: {
      data: [{ id: COURSE_ID, updated_at: NEW_UPDATED_AT, previous_status: 'draft' }],
      error: null,
    },
  });
  const response = await handleAdminCourses(request(statusBody), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { courseId: COURSE_ID, updatedAt: NEW_UPDATED_AT });
  assertEquals(rpcCalls, [{
    schema: 'app',
    fn: 'staff_set_course_status',
    args: { p_course_id: COURSE_ID, p_expected_updated_at: UPDATED_AT, p_status: 'published' },
  }]);
  assertEquals(captures.length, 1);
  assertEquals(captures[0]?.event, 'admin_course_status_changed');
  assertEquals(captures[0]?.distinctId, ACTOR_ID);
  assertEquals(captures[0]?.properties, {
    course_id: COURSE_ID,
    actor_user_id: ACTOR_ID,
    old_status: 'draft',
    new_status: 'published',
    request_id: captures[0]?.properties?.request_id,
  });
});

Deno.test('set_status with an empty result is a 500', async () => {
  const { deps } = setup({ rpc: { data: [], error: null } });
  assertEquals((await handleAdminCourses(request(statusBody), deps)).status, 500);
});

Deno.test('invalid_transition is a 409 with the stable code and a denied event', async () => {
  const { deps, captures } = setup({
    rpc: { data: null, error: { message: 'invalid_transition', code: 'CR005' } },
  });
  const response = await handleAdminCourses(request(statusBody), deps);
  assertEquals(response.status, 409);
  assertEquals((await errorOf(response)).code, 'invalid_transition');
  assertEquals(captures[0]?.event, 'admin_action_denied');
  assertEquals(captures[0]?.properties?.course_action, 'set_status');
});

Deno.test('publish_gate_violated returns the violation list from the error DETAIL', async () => {
  const details = JSON.stringify([
    { code: 'price_missing' },
    { code: 'lesson_without_video', lessonId: LESSON_ID },
  ]);
  const { deps, captures } = setup({
    rpc: {
      data: null,
      error: { message: 'publish_gate_violated', code: 'CR004', details } as never,
    },
  });
  const response = await handleAdminCourses(request(statusBody), deps);
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.error.code, 'publish_gate_violated');
  assertEquals(body.error.violations, [
    { code: 'price_missing' },
    { code: 'lesson_without_video', lessonId: LESSON_ID },
  ]);
  assertEquals(captures[0]?.properties?.violation_codes, ['price_missing', 'lesson_without_video']);
});

Deno.test('malformed or hostile DETAIL yields no violations instead of failing', async () => {
  for (
    const details of [
      'not json',
      '{"code":"price_missing"}',
      '[{"code":"drop table"}]',
      '[{"code":"lesson_without_video","lessonId":"x"}]',
    ]
  ) {
    const { deps } = setup({
      rpc: {
        data: null,
        error: { message: 'publish_gate_violated', code: 'CR004', details } as never,
      },
    });
    const response = await handleAdminCourses(request(statusBody), deps);
    assertEquals(response.status, 409);
    assertEquals((await response.json()).error.violations, []);
  }
});

Deno.test('delete calls staff_delete_course and emits a deletion event', async () => {
  const { deps, rpcCalls, captures } = setup({ rpc: { data: null, error: null } });
  const response = await handleAdminCourses(request(deleteBody), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { courseId: COURSE_ID });
  assertEquals(rpcCalls, [{
    schema: 'app',
    fn: 'staff_delete_course',
    args: { p_course_id: COURSE_ID, p_expected_updated_at: UPDATED_AT },
  }]);
  assertEquals(captures.length, 1);
  assertEquals(captures[0]?.event, 'admin_course_deleted');
  assertEquals(captures[0]?.properties?.course_id, COURSE_ID);
  assertEquals(captures[0]?.properties?.actor_user_id, ACTOR_ID);
});

Deno.test('delete with sales is a 409 course_has_sales and emits no deletion event', async () => {
  const { deps, captures } = setup({ rpc: { data: null, error: { message: 'course_has_sales' } } });
  const response = await handleAdminCourses(request(deleteBody), deps);
  assertEquals(response.status, 409);
  assertEquals((await errorOf(response)).code, 'course_has_sales');
  assertEquals(captures.map((c) => c.event), ['admin_action_denied']);
});
