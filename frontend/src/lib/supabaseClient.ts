import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

// Small factory (instead of only a bare singleton) so tests can build an
// isolated client without touching the validated env singleton, and so a
// future multi-tenant/staging setup has a seam to hook into.
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!url.trim()) {
    throw new Error('createSupabaseClient: url must not be blank.')
  }
  if (!anonKey.trim()) {
    throw new Error('createSupabaseClient: anonKey must not be blank.')
  }

  return createClient(url, anonKey)
}

// Single client instance for the whole app — the frontend only ever talks to
// Postgres through RLS-protected PostgREST queries or Supabase Auth, never
// directly to the video provider, payment gateway, or Resend.
export const supabase: SupabaseClient = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey)
