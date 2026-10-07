import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  const queryClient = useQueryClient()
  const lastUserIdRef = useRef<string | null>(null)
  // A primeira resolução da sessão (getSession ou INITIAL_SESSION, o que vier
  // antes) apenas hidrata o id: não é troca de usuário, e resetar o cache ali
  // descartaria queries já em voo (ex.: catálogo) e travaria o spinner.
  const hasHydratedRef = useRef(false)

  // Único ponto de limpeza do cache: tudo em cache (papel, lista de usuários
  // com PII) pertence ao usuário anterior. Idempotente por id, então
  // signOut + evento SIGNED_OUT resetam uma unica vez. resetQueries (e não
  // clear) descarta os dados mas mantém as queries ativas inscritas, que são
  // refeitas para o novo usuário.
  const syncUserId = useCallback(
    (nextUserId: string | null) => {
      const isHydration = !hasHydratedRef.current
      hasHydratedRef.current = true
      if (!isHydration && nextUserId !== lastUserIdRef.current) {
        void queryClient.resetQueries()
      }
      lastUserIdRef.current = nextUserId
    },
    [queryClient],
  )

  useEffect(() => {
    let isMounted = true

    client.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return
      }
      if (error) {
        console.error('Failed to load the initial auth session:', error)
      }
      // Um evento de auth já hidratou (e pode ter avançado além deste
      // snapshot): o resultado de getSession é obsoleto, ignora.
      if (hasHydratedRef.current) {
        return
      }
      syncUserId(data.session?.user.id ?? null)
      setSession(data.session ?? null)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return
      }
      syncUserId(nextSession?.user.id ?? null)
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [client, syncUserId])

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
        syncUserId(null)
        return { error: error ? toFriendlyAuthMessage(error.message) : null }
      },
    }),
    [session, isLoading, client, syncUserId],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
