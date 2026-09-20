import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultSupabaseClient } from '../../lib/supabaseClient'
import { AuthContext, type AuthContextValue, type AuthResult } from './AuthContext'
import { toFriendlyAuthMessage } from './authErrors'

export interface AuthProviderProps {
  readonly children: ReactNode
  // Injected for testing against a mocked Supabase auth client; defaults to
  // the real singleton for runtime use.
  readonly client?: SupabaseClient
}

export function AuthProvider({ children, client = defaultSupabaseClient }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    client.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return
      }
      if (error) {
        console.error('Failed to load the initial auth session:', error)
      }
      setSession(data.session ?? null)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return
      }
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [client])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      signIn: async (email, password): Promise<AuthResult> => {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        return { error: error ? toFriendlyAuthMessage(error.message) : null }
      },
      signUp: async (email, password): Promise<AuthResult> => {
        const { error } = await client.auth.signUp({
          email: email.trim(),
          password,
        })
        return { error: error ? toFriendlyAuthMessage(error.message) : null }
      },
      signOut: async (): Promise<AuthResult> => {
        const { error } = await client.auth.signOut()
        return { error: error ? toFriendlyAuthMessage(error.message) : null }
      },
    }),
    [session, isLoading, client],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
