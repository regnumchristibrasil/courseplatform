import { useCallback } from 'react'
import { useAuth } from '../../auth/useAuth'
import { AdminUsersApiError } from './api'

// HTTP 401 (JWT inválido/expirado): encerra a sessão local; o ProtectedRoute
// redireciona para /login quando a sessão some.
export function useSessionExpiryHandler(): (error: unknown) => void {
  const { signOut } = useAuth()
  return useCallback(
    (error: unknown) => {
      if (!(error instanceof AdminUsersApiError) || error.code !== 'unauthorized') return
      void signOut().then(({ error: signOutError }) => {
        if (signOutError) console.error('Failed to sign out after session expiry:', signOutError)
      })
    },
    [signOut],
  )
}
