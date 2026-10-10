import { useEffect } from 'react'
import { useAuth } from '../../auth/useAuth'
import { AdminCoursesApiError } from './api'

// HTTP 401 (JWT inválido/expirado): encerra a sessão local; o ProtectedRoute
// redireciona para /login quando a sessão some.
export function useUnauthorizedSignOut(error: unknown): void {
  const { signOut } = useAuth()

  useEffect(() => {
    if (!(error instanceof AdminCoursesApiError) || error.code !== 'unauthorized') return
    void signOut().then(({ error: signOutError }) => {
      if (signOutError) console.error('Failed to sign out after session expiry:', signOutError)
    })
  }, [error, signOut])
}
