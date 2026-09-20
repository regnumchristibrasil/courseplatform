// Two distinct Supabase client factories -- deliberately NOT collapsed into
// one parameterized function. Which client a function uses is a safety
// decision, not a convenience knob:
//
// - `createServiceRoleClient` bypasses RLS entirely. Only for functions/cron
//   jobs that legitimately need broad access (webhook handler, reconcile,
//   outbox-drain).
// - `createCallerClient` runs every query under the *caller's* JWT, so RLS
//   and SECURITY DEFINER `auth.uid()` context stay correct. Required for
//   `video-resolve`, where the enrollment check must be structurally
//   impossible to bypass (see prompt_course_platform.md).
//
// `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
// auto-injected into every deployed Edge Function -- callers normally pass
// no `env` override and this reads `Deno.env` directly. Tests/local runs can
// override `env` explicitly.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type EnvSource, requireEnv } from './config.ts';

// A deliberately narrow injection point -- just enough of `createClient`'s
// shape to be testable with a fake, without dragging its full generic
// (Database-typed) overload signature into this module's public API.
export interface ClientOptions {
  readonly auth: { readonly persistSession: boolean; readonly autoRefreshToken: boolean };
  readonly global?: { readonly headers: Readonly<Record<string, string>> };
}
export type CreateClientFn = (url: string, key: string, options: ClientOptions) => SupabaseClient;

export class MissingAuthorizationError extends Error {
  constructor() {
    super('Request has no Authorization header -- cannot create a caller-JWT Supabase client');
    this.name = 'MissingAuthorizationError';
  }
}

function readEnv(env: EnvSource | undefined, name: string): string {
  const source = env ?? Deno.env.toObject();
  return requireEnv(name, source);
}

// Broad access -- bypasses RLS. Use only where the function's own logic is
// the access-control boundary (e.g. after signature verification on a
// webhook), never as a default/shortcut.
export function createServiceRoleClient(
  env?: EnvSource,
  createClientFn: CreateClientFn = createClient as CreateClientFn,
): SupabaseClient {
  const url = readEnv(env, 'SUPABASE_URL');
  const serviceRoleKey = readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
  return createClientFn(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Runs under the caller's own JWT (forwarded as the Authorization header),
// so RLS policies and `auth.uid()` evaluate as that user -- not
// service_role. Throws `MissingAuthorizationError` rather than silently
// falling back to an unauthenticated/anon-only client.
export function createCallerClient(
  request: Request,
  env?: EnvSource,
  createClientFn: CreateClientFn = createClient as CreateClientFn,
): SupabaseClient {
  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    throw new MissingAuthorizationError();
  }
  const url = readEnv(env, 'SUPABASE_URL');
  const anonKey = readEnv(env, 'SUPABASE_ANON_KEY');
  return createClientFn(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}
