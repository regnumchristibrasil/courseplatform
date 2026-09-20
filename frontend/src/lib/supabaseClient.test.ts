import { describe, expect, it } from 'vitest'
import { createSupabaseClient, supabase } from './supabaseClient'

describe('createSupabaseClient', () => {
  it('builds a Supabase client exposing the auth and postgrest surfaces', () => {
    const client = createSupabaseClient('https://project-ref.supabase.co', 'anon-key-123')

    expect(client.auth).toBeDefined()
    expect(typeof client.auth.getSession).toBe('function')
    expect(typeof client.from).toBe('function')
  })

  it('throws when given a blank URL rather than silently building a broken client', () => {
    expect(() => createSupabaseClient('', 'anon-key-123')).toThrow()
  })

  it('throws when given a blank anon key rather than silently building a broken client', () => {
    expect(() => createSupabaseClient('https://project-ref.supabase.co', '')).toThrow()
  })
})

describe('supabase singleton', () => {
  it('is constructed once from the validated env config', () => {
    expect(supabase).toBeDefined()
    expect(typeof supabase.from).toBe('function')
  })
})
