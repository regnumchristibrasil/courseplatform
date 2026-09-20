import { assertEquals, assertExists, assertThrows } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ClientOptions,
  createCallerClient,
  type CreateClientFn,
  createServiceRoleClient,
  MissingAuthorizationError,
} from './supabase.ts';
import { MissingEnvVarError } from './config.ts';

const SUPABASE_ENV = {
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

interface CapturedCall {
  readonly url: string;
  readonly key: string;
  readonly options: ClientOptions;
}

function fakeCreateClient(): { fn: CreateClientFn; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fn: CreateClientFn = (url, key, options) => {
    calls.push({ url, key, options });
    return { __fake: true } as unknown as SupabaseClient;
  };
  return { fn, calls };
}

function firstCall(calls: readonly CapturedCall[]): CapturedCall {
  const call = calls[0];
  assertExists(call);
  return call;
}

Deno.test('createServiceRoleClient builds a client with the service role key', () => {
  const { fn, calls } = fakeCreateClient();
  createServiceRoleClient(SUPABASE_ENV, fn);
  assertEquals(calls.length, 1);
  assertEquals(firstCall(calls).url, SUPABASE_ENV.SUPABASE_URL);
  assertEquals(firstCall(calls).key, SUPABASE_ENV.SUPABASE_SERVICE_ROLE_KEY);
});

Deno.test('createServiceRoleClient disables session persistence (service role has no user session)', () => {
  const { fn, calls } = fakeCreateClient();
  createServiceRoleClient(SUPABASE_ENV, fn);
  const options = firstCall(calls).options;
  assertEquals(options.auth.persistSession, false);
  assertEquals(options.auth.autoRefreshToken, false);
});

Deno.test('createServiceRoleClient throws MissingEnvVarError when SUPABASE_URL is absent', () => {
  const { fn } = fakeCreateClient();
  assertThrows(
    () => createServiceRoleClient({ SUPABASE_SERVICE_ROLE_KEY: 'x' }, fn),
    MissingEnvVarError,
  );
});

Deno.test('createServiceRoleClient throws MissingEnvVarError when the service role key is absent', () => {
  const { fn } = fakeCreateClient();
  assertThrows(
    () => createServiceRoleClient({ SUPABASE_URL: 'https://project-ref.supabase.co' }, fn),
    MissingEnvVarError,
  );
});

Deno.test('createCallerClient uses the anon key, never the service role key', () => {
  const { fn, calls } = fakeCreateClient();
  const request = new Request('https://example.com', {
    headers: { Authorization: 'Bearer caller-jwt' },
  });
  createCallerClient(request, SUPABASE_ENV, fn);
  assertEquals(firstCall(calls).key, SUPABASE_ENV.SUPABASE_ANON_KEY);
});

Deno.test('createCallerClient forwards the caller Authorization header so RLS runs as the caller', () => {
  const { fn, calls } = fakeCreateClient();
  const request = new Request('https://example.com', {
    headers: { Authorization: 'Bearer caller-jwt' },
  });
  createCallerClient(request, SUPABASE_ENV, fn);
  const options = firstCall(calls).options;
  assertEquals(options.global?.headers.Authorization, 'Bearer caller-jwt');
});

Deno.test('createCallerClient throws MissingAuthorizationError when there is no Authorization header', () => {
  const { fn } = fakeCreateClient();
  const request = new Request('https://example.com');
  assertThrows(() => createCallerClient(request, SUPABASE_ENV, fn), MissingAuthorizationError);
});

Deno.test('createCallerClient throws MissingEnvVarError when SUPABASE_ANON_KEY is absent', () => {
  const { fn } = fakeCreateClient();
  const request = new Request('https://example.com', {
    headers: { Authorization: 'Bearer caller-jwt' },
  });
  assertThrows(
    () => createCallerClient(request, { SUPABASE_URL: 'https://project-ref.supabase.co' }, fn),
    MissingEnvVarError,
  );
});

Deno.test('service role and caller client factories never share a key -- collapsing them defeats RLS isolation', () => {
  const { fn: serviceFn, calls: serviceCalls } = fakeCreateClient();
  const { fn: callerFn, calls: callerCalls } = fakeCreateClient();
  createServiceRoleClient(SUPABASE_ENV, serviceFn);
  createCallerClient(
    new Request('https://example.com', { headers: { Authorization: 'Bearer x' } }),
    SUPABASE_ENV,
    callerFn,
  );
  assertEquals(firstCall(serviceCalls).key === firstCall(callerCalls).key, false);
});
