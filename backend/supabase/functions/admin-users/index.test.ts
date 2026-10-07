import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_USERS_ERROR_STATUS } from '../../../contracts/adminUsers.ts';
import type { CaptureEventInput, CaptureResult, PostHogEnv } from '../_shared/observability.ts';
import { MissingAuthorizationError } from '../_shared/supabase.ts';
import { type AdminUsersDeps, handleAdminUsers } from './index.ts';

const POSTHOG_ENV: PostHogEnv = {
  apiKey: 'phc_test',
  host: 'https://us.i.posthog.com',
};
const URL = 'https://example.com/functions/v1/admin-users';
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const JWT = 'jwt-super-secret-token';
const SERVICE_KEY = 'service-role-key-do-not-log';

interface RpcError {
  readonly message: string;
  readonly code?: string;
  readonly hint?: string;
}
interface RpcResult {
  readonly data: unknown;
  readonly error: RpcError | null;
}

interface Harness {
  readonly deps: AdminUsersDeps;
  readonly events: string[];
  readonly rpcCalls: { fn: string; args: unknown; schema: string }[];
  readonly getUserTokens: (string | undefined)[];
  readonly banCalls: { id: string; attrs: unknown }[];
  readonly serviceFactoryCalls: () => number;
  readonly captures: CaptureEventInput[];
  readonly logs: string[];
}

interface HarnessOptions {
  readonly rpc?: RpcResult;
  readonly rpcThrows?: unknown;
  readonly user?: { id: string } | null;
  readonly getUserError?: boolean;
  readonly missingAuth?: boolean;
  readonly banError?: { message: string } | null;
  readonly banThrows?: unknown;
  readonly banFailsFirstCallOnly?: boolean;
  readonly factoryThrows?: boolean;
  readonly captureThrows?: boolean;
  readonly captureFails?: boolean;
}

const okRow = (isActive: boolean): RpcResult => ({
  data: [{
    user_id: TARGET_ID,
    is_active: isActive,
    updated_at: '2026-10-05T12:00:00Z',
  }],
  error: null,
});

function harness(o: HarnessOptions = {}): Harness {
  const events: string[] = [];
  const rpcCalls: Harness['rpcCalls'] = [];
  const getUserTokens: (string | undefined)[] = [];
  const banCalls: Harness['banCalls'] = [];
  const captures: CaptureEventInput[] = [];
  const logs: string[] = [];
  let factoryCalls = 0;
  let banAttempts = 0;

  const caller = {
    auth: {
      getUser(token?: string) {
        getUserTokens.push(token);
        if (o.getUserError) {
          return Promise.resolve({
            data: { user: null },
            error: { message: 'bad jwt' },
          });
        }
        const user = o.user === undefined ? { id: ACTOR_ID } : o.user;
        return Promise.resolve({ data: { user }, error: null });
      },
    },
    schema(schema: string) {
      return {
        rpc(fn: string, args: unknown) {
          events.push('rpc');
          rpcCalls.push({ fn, args, schema });
          if (o.rpcThrows !== undefined) return Promise.reject(o.rpcThrows);
          return Promise.resolve(o.rpc ?? okRow(false));
        },
      };
    },
  } as unknown as SupabaseClient;

  const service = {
    auth: {
      admin: {
        updateUserById(id: string, attrs: unknown) {
          events.push('ban');
          banCalls.push({ id, attrs });
          banAttempts += 1;
          if (o.banThrows !== undefined) return Promise.reject(o.banThrows);
          const failing = o.banFailsFirstCallOnly ? banAttempts === 1 : true;
          return Promise.resolve({ data: {}, error: failing ? (o.banError ?? null) : null });
        },
      },
    },
  } as unknown as SupabaseClient;

  const deps: AdminUsersDeps = {
    postHogEnv: POSTHOG_ENV,
    createCallerClientFn: () => {
      if (o.missingAuth) throw new MissingAuthorizationError();
      return caller;
    },
    createServiceRoleClientFn: () => {
      factoryCalls += 1;
      if (o.factoryThrows) throw new Error(`missing env ${SERVICE_KEY}`);
      return service;
    },
    captureFn: (_env, input): Promise<CaptureResult> => {
      if (o.captureThrows) return Promise.reject(new Error('posthog down'));
      captures.push(input);
      return Promise.resolve(
        o.captureFails ? { ok: false, error: 'x' } : { ok: true },
      );
    },
    logFn: (line: string) => logs.push(line),
  };

  return {
    deps,
    events,
    rpcCalls,
    getUserTokens,
    banCalls,
    serviceFactoryCalls: () => factoryCalls,
    captures,
    logs,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${JWT}` },
) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const deactivate = {
  action: 'set_active',
  userId: TARGET_ID,
  active: false,
  expectedActive: true,
};
const reactivate = {
  action: 'set_active',
  userId: TARGET_ID,
  active: true,
  expectedActive: false,
};

Deno.test('OPTIONS returns CORS preflight and touches nothing', async () => {
  const h = harness();
  const res = await handleAdminUsers(
    new Request(URL, { method: 'OPTIONS' }),
    h.deps,
  );
  assertEquals(res.status, 204);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('non-POST gets 405', async () => {
  const h = harness();
  const res = await handleAdminUsers(
    new Request(URL, { method: 'GET' }),
    h.deps,
  );
  assertEquals(res.status, 405);
  assertEquals((await res.json()).error.code, 'method_not_allowed');
});

Deno.test('deactivate: RPC first, then ban 876000h, 200 contract body', async () => {
  const h = harness({ rpc: okRow(false) });
  const res = await handleAdminUsers(
    post({ ...deactivate, reason: 'abuse' }),
    h.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { userId: TARGET_ID, isActive: false });
  assertEquals(h.events, ['rpc', 'ban']);
  assertEquals(h.rpcCalls[0]?.schema, 'app');
  assertEquals(h.rpcCalls[0]?.fn, 'admin_set_user_active');
  assertEquals(h.rpcCalls[0]?.args, {
    p_target: TARGET_ID,
    p_active: false,
    p_expected_active: true,
    p_reason: 'abuse',
  });
  assertEquals(h.banCalls, [{
    id: TARGET_ID,
    attrs: { ban_duration: '876000h' },
  }]);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('actor identity comes from the JWT, never the body', async () => {
  const h = harness();
  await handleAdminUsers(post({ ...deactivate }), h.deps);
  assertEquals(h.getUserTokens, [JWT]);
  const args = h.rpcCalls[0]?.args as Record<string, unknown>;
  assertFalse('p_actor' in args);
  assertEquals(h.captures[0]?.distinctId, ACTOR_ID);
});

Deno.test('reactivate: unban with none', async () => {
  const h = harness({ rpc: okRow(true) });
  const res = await handleAdminUsers(post(reactivate), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { userId: TARGET_ID, isActive: true });
  assertEquals(h.banCalls, [{
    id: TARGET_ID,
    attrs: { ban_duration: 'none' },
  }]);
});

Deno.test('reason omitted is sent as null to the RPC', async () => {
  const h = harness();
  await handleAdminUsers(post(deactivate), h.deps);
  assertEquals((h.rpcCalls[0]?.args as Record<string, unknown>).p_reason, null);
});

Deno.test('no-op RPC (already inactive) still re-syncs Auth', async () => {
  const h = harness({ rpc: okRow(false) });
  const res = await handleAdminUsers(
    post({ ...deactivate, expectedActive: false }),
    h.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(h.events, ['rpc', 'ban']);
  assertEquals(h.banCalls[0]?.attrs, { ban_duration: '876000h' });
});

Deno.test('Auth error returns 502 auth_sync_failed, DB result not rolled back', async () => {
  const h = harness({ banError: { message: 'auth down' } });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, 'auth_sync_failed');
  assertMatch(body.error.requestId, /^[0-9a-f-]{36}$/);
  assertEquals(h.rpcCalls.length, 1);
});

Deno.test('Auth sync failure emits admin_user_status_sync_failed with ids only', async () => {
  const h = harness({ banError: { message: 'auth down secret-detail' } });
  const res = await handleAdminUsers(
    post({ ...deactivate, reason: 'private reason text' }),
    h.deps,
  );
  const requestId = (await res.json()).error.requestId;
  assertEquals(h.captures.length, 1);
  const c = h.captures[0]!;
  assertEquals(c.event, 'admin_user_status_sync_failed');
  assertEquals(c.distinctId, ACTOR_ID);
  assertEquals(c.properties, {
    error_code: 'auth_sync_failed',
    request_id: requestId,
    actor_user_id: ACTOR_ID,
    target_user_id: TARGET_ID,
    new_active: false,
  });
  const dump = JSON.stringify(c);
  assertFalse(dump.includes('private reason text'));
  assertFalse(dump.includes('secret-detail'));
});

Deno.test('unknown RPC error emits an exception event with ids and SQLSTATE only', async () => {
  const h = harness({
    rpc: { data: null, error: { message: 'relation secret_table broken', code: 'XX000' } },
  });
  const res = await handleAdminUsers(
    post({ ...deactivate, reason: 'private reason text' }),
    h.deps,
  );
  assertEquals(res.status, 500);
  const requestId = (await res.json()).error.requestId;
  assertEquals(h.captures.length, 1);
  const c = h.captures[0]!;
  assertEquals(c.event, '$exception');
  assertEquals(c.properties, {
    error_code: 'internal_error',
    sqlstate: 'XX000',
    request_id: requestId,
    actor_user_id: ACTOR_ID,
    target_user_id: TARGET_ID,
  });
  const dump = JSON.stringify(c);
  assertFalse(dump.includes('secret_table'));
  assertFalse(dump.includes('private reason text'));
});

Deno.test('capture failure on the 502 and 500 paths never changes the response', async () => {
  const bad502 = harness({ banError: { message: 'x' }, captureThrows: true });
  assertEquals((await handleAdminUsers(post(deactivate), bad502.deps)).status, 502);
  const bad500 = harness({
    rpc: { data: null, error: { message: 'boom' } },
    captureFails: true,
  });
  assertEquals((await handleAdminUsers(post(deactivate), bad500.deps)).status, 500);
});

Deno.test('retry of the identical payload after a 502 returns 200 and re-bans', async () => {
  // First attempt: DB change committed, Auth ban fails. The retry sends the
  // same payload; the RPC (no-op, returns the row) lets the Auth sync happen.
  const h = harness({ banError: { message: 'auth down' }, banFailsFirstCallOnly: true });
  const first = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(first.status, 502);
  const second = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(second.status, 200);
  assertEquals(await second.json(), { userId: TARGET_ID, isActive: false });
  assertEquals(h.rpcCalls.length, 2);
  assertEquals(h.rpcCalls[0]!.args, h.rpcCalls[1]!.args);
  assertEquals(h.banCalls.length, 2);
  assertEquals(h.banCalls[1]!.attrs, { ban_duration: '876000h' });
});

Deno.test('request body above 4096 bytes -> 400 invalid_input, no RPC', async () => {
  const h = harness();
  const res = await handleAdminUsers(
    post({ ...deactivate, reason: 'x'.repeat(5000) }),
    h.deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, 'invalid_input');
  assertEquals(h.rpcCalls.length, 0);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('empty reason is sent as null to the RPC', async () => {
  const h = harness();
  await handleAdminUsers(post({ ...deactivate, reason: '' }), h.deps);
  assertEquals((h.rpcCalls[0]!.args as { p_reason: unknown }).p_reason, null);
});

Deno.test('Auth throw returns 502 auth_sync_failed', async () => {
  const h = harness({ banThrows: new Error('network') });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, 'auth_sync_failed');
});

Deno.test('service-role factory throwing returns 502 auth_sync_failed', async () => {
  const h = harness({ factoryThrows: true });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, 'auth_sync_failed');
  assertFalse(h.logs.join('\n').includes(SERVICE_KEY));
});

const RPC_ERRORS = [
  ['forbidden', '42501'],
  ['invalid_input', '22023'],
  ['not_found', 'P0002'],
  ['self_target', 'AD001'],
  ['actor_inactive', 'AD002'],
  ['stale_target', 'AD003'],
  ['last_superadmin', 'AD004'],
] as const;

Deno.test('every RPC error maps to its contract code and status; service role untouched', async () => {
  for (const [code, sqlstate] of RPC_ERRORS) {
    const h = harness({
      rpc: { data: null, error: { message: code, code: sqlstate, hint: code } },
    });
    const res = await handleAdminUsers(post(deactivate), h.deps);
    assertEquals(res.status, ADMIN_USERS_ERROR_STATUS[code], code);
    const body = await res.json();
    assertEquals(body.error.code, code);
    assert(body.error.requestId);
    assertEquals(h.serviceFactoryCalls(), 0, code);
    assertEquals(h.banCalls.length, 0, code);
  }
});

Deno.test('unknown RPC error -> 500 internal_error with requestId, no leak', async () => {
  const h = harness({
    rpc: { data: null, error: { message: 'relation secret_table broken' } },
  });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, 'internal_error');
  assertFalse(JSON.stringify(body).includes('secret_table'));
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('RPC throw -> 500 internal_error, service role untouched', async () => {
  const h = harness({ rpcThrows: new Error('net') });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 500);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('RPC success with no rows -> 500 internal_error, service role untouched', async () => {
  const h = harness({ rpc: { data: [], error: null } });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 500);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('missing Authorization header -> 401, nothing touched', async () => {
  const h = harness({ missingAuth: true });
  const res = await handleAdminUsers(post(deactivate, {}), h.deps);
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.code, 'unauthorized');
  assertEquals(h.rpcCalls.length, 0);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('invalid JWT (getUser error) -> 401, no RPC, service role untouched', async () => {
  const h = harness({ getUserError: true });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 401);
  assertEquals(h.rpcCalls.length, 0);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('getUser returns no user -> 401', async () => {
  const h = harness({ user: null });
  const res = await handleAdminUsers(post(deactivate), h.deps);
  assertEquals(res.status, 401);
  assertEquals(h.serviceFactoryCalls(), 0);
});

Deno.test('malformed Authorization scheme -> 401', async () => {
  const h = harness();
  const res = await handleAdminUsers(
    post(deactivate, { Authorization: 'Basic abc' }),
    h.deps,
  );
  assertEquals(res.status, 401);
  assertEquals(h.rpcCalls.length, 0);
});

Deno.test('invalid bodies -> 400 invalid_input, no RPC, service role untouched', async () => {
  const bodies: unknown[] = [
    { action: 'set_active', active: true, expectedActive: false },
    { ...deactivate, userId: 'bad' },
    { ...deactivate, active: 'no' },
    { ...deactivate, extra: 1 },
    { ...deactivate, reason: 'x'.repeat(501) },
    { ...deactivate, action: 'list' },
  ];
  for (const body of bodies) {
    const h = harness();
    const res = await handleAdminUsers(post(body), h.deps);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error.code, 'invalid_input');
    assertEquals(h.rpcCalls.length, 0);
    assertEquals(h.serviceFactoryCalls(), 0);
  }
});

Deno.test('non-JSON body -> 400 invalid_input', async () => {
  const h = harness();
  const req = new Request(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}` },
    body: '{nope',
  });
  const res = await handleAdminUsers(req, h.deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, 'invalid_input');
});

Deno.test('PostHog: success emits admin_user_status_changed without email or reason', async () => {
  const h = harness({ rpc: okRow(false) });
  await handleAdminUsers(
    post({ ...deactivate, reason: 'private reason text' }),
    h.deps,
  );
  assertEquals(h.captures.length, 1);
  const c = h.captures[0]!;
  assertEquals(c.event, 'admin_user_status_changed');
  assertEquals(c.distinctId, ACTOR_ID);
  assertEquals(Object.keys(c.properties ?? {}).sort(), [
    'actor_user_id',
    'new_active',
    'request_id',
    'target_user_id',
  ]);
  assertEquals(c.properties?.target_user_id, TARGET_ID);
  assertEquals(c.properties?.actor_user_id, ACTOR_ID);
  assertEquals(c.properties?.new_active, false);
  assertFalse(JSON.stringify(c).includes('private reason text'));
});

Deno.test('PostHog: denial emits admin_action_denied with code, request id, actor', async () => {
  const h = harness({
    rpc: { data: null, error: { message: 'forbidden', code: '42501' } },
  });
  const res = await handleAdminUsers(
    post({ ...deactivate, reason: 'secret reason' }),
    h.deps,
  );
  const requestId = (await res.json()).error.requestId;
  assertEquals(h.captures.length, 1);
  const c = h.captures[0]!;
  assertEquals(c.event, 'admin_action_denied');
  assertEquals(c.distinctId, ACTOR_ID);
  assertEquals(c.properties?.error_code, 'forbidden');
  assertEquals(c.properties?.request_id, requestId);
  assertEquals(c.properties?.actor_user_id, ACTOR_ID);
  assertFalse(JSON.stringify(c).includes('secret reason'));
});

Deno.test('PostHog capture failure or throw never fails the request', async () => {
  for (const o of [{ captureThrows: true }, { captureFails: true }]) {
    const h = harness(o);
    const res = await handleAdminUsers(post(deactivate), h.deps);
    assertEquals(res.status, 200);
  }
  const h = harness({
    captureThrows: true,
    rpc: { data: null, error: { message: 'forbidden' } },
  });
  assertEquals((await handleAdminUsers(post(deactivate), h.deps)).status, 403);
});

Deno.test('logs never contain JWT, service key or reason text', async () => {
  const scenarios: HarnessOptions[] = [
    { banError: { message: 'auth down' } },
    { banThrows: new Error('network') },
    { rpc: { data: null, error: { message: 'weird failure' } } },
    { rpcThrows: new Error('net') },
    { factoryThrows: true },
    { captureThrows: true },
  ];
  for (const s of scenarios) {
    const h = harness(s);
    await handleAdminUsers(
      post({ ...deactivate, reason: 'reason-text-xyz' }),
      h.deps,
    );
    const all = h.logs.join('\n');
    assertFalse(all.includes(JWT));
    assertFalse(all.includes(SERVICE_KEY));
    assertFalse(all.includes('reason-text-xyz'));
  }
});

Deno.test('502 and 500 paths log something for operators', async () => {
  const h = harness({ banError: { message: 'auth down' } });
  await handleAdminUsers(post(deactivate), h.deps);
  assert(h.logs.length > 0);
});
