// Fail-fast environment validation. Every VITE_-prefixed variable ships
// inside the client bundle (see .env.example) — never add a secret key here.

export const REQUIRED_ENV_KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_POSTHOG_KEY',
  'VITE_POSTHOG_HOST',
  'VITE_APP_ENV',
] as const

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number]

export interface AppEnv {
  readonly supabaseUrl: string
  readonly supabaseAnonKey: string
  readonly posthogKey: string
  readonly posthogHost: string
  readonly appEnv: string
}

// Loosely typed on purpose: this is validated against Vite's `ImportMetaEnv`
// (which mixes strings and booleans), and against plain object literals in
// tests, without forcing callers to satisfy Vite's full ambient shape.
export type RawEnv = Readonly<Record<string, string | boolean | undefined>>

function isBlank(value: string | boolean | undefined): value is undefined {
  return typeof value !== 'string' || value.trim().length === 0
}

function isWellFormedUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export function validateEnv(raw: RawEnv): AppEnv {
  const missing: RequiredEnvKey[] = REQUIRED_ENV_KEYS.filter((key) => isBlank(raw[key]))

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in your .env file — see .env.example for the full list.',
    )
  }

  const supabaseUrl = raw.VITE_SUPABASE_URL as string
  if (!isWellFormedUrl(supabaseUrl)) {
    throw new Error(
      `Invalid VITE_SUPABASE_URL: "${supabaseUrl}" is not a well-formed URL.`,
    )
  }

  return {
    supabaseUrl,
    supabaseAnonKey: raw.VITE_SUPABASE_ANON_KEY as string,
    posthogKey: raw.VITE_POSTHOG_KEY as string,
    posthogHost: raw.VITE_POSTHOG_HOST as string,
    appEnv: raw.VITE_APP_ENV as string,
  }
}

// Eager, module-level validation so a misconfigured deployment fails loudly
// at app boot instead of surfacing as a mysterious `undefined` deep in a
// component (e.g. a Supabase client silently pointed at "undefined/rest/v1").
export const env: AppEnv = validateEnv(import.meta.env as unknown as RawEnv)
