import { describe, expect, it } from 'vitest'
import { REQUIRED_ENV_KEYS, validateEnv } from './env'

function buildValidRawEnv(): Record<string, string> {
  return {
    VITE_SUPABASE_URL: 'https://project-ref.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key-123',
    VITE_POSTHOG_KEY: 'phc_test_key',
    VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
    VITE_APP_ENV: 'development',
  }
}

describe('validateEnv', () => {
  it('returns a typed config when every required variable is present', () => {
    const result = validateEnv(buildValidRawEnv())

    expect(result).toEqual({
      supabaseUrl: 'https://project-ref.supabase.co',
      supabaseAnonKey: 'anon-key-123',
      posthogKey: 'phc_test_key',
      posthogHost: 'https://us.i.posthog.com',
      appEnv: 'development',
    })
  })

  it('throws a descriptive error naming the single missing variable', () => {
    const raw = buildValidRawEnv()
    delete raw.VITE_SUPABASE_URL

    expect(() => validateEnv(raw)).toThrow(/VITE_SUPABASE_URL/)
  })

  it('throws a single error listing every missing variable, not just the first', () => {
    const raw = buildValidRawEnv()
    delete raw.VITE_SUPABASE_URL
    delete raw.VITE_POSTHOG_KEY

    try {
      validateEnv(raw)
      throw new Error('expected validateEnv to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain('VITE_SUPABASE_URL')
      expect(message).toContain('VITE_POSTHOG_KEY')
    }
  })

  it('treats an empty string as missing, not as a valid empty value', () => {
    const raw = buildValidRawEnv()
    raw.VITE_SUPABASE_ANON_KEY = ''

    expect(() => validateEnv(raw)).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('treats a whitespace-only string as missing', () => {
    const raw = buildValidRawEnv()
    raw.VITE_APP_ENV = '   '

    expect(() => validateEnv(raw)).toThrow(/VITE_APP_ENV/)
  })

  it('rejects a VITE_SUPABASE_URL that is not a well-formed URL', () => {
    const raw = buildValidRawEnv()
    raw.VITE_SUPABASE_URL = 'not-a-url'

    expect(() => validateEnv(raw)).toThrow(/VITE_SUPABASE_URL/)
  })

  it('never proceeds with undefined values baked into the returned config', () => {
    const raw = buildValidRawEnv()
    delete raw.VITE_POSTHOG_HOST

    expect(() => validateEnv(raw)).toThrow()
  })

  it('exposes the required key list so callers/docs can stay in sync', () => {
    expect(REQUIRED_ENV_KEYS).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_POSTHOG_KEY',
      'VITE_POSTHOG_HOST',
      'VITE_APP_ENV',
    ])
  })
})
