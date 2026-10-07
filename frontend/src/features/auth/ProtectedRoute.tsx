import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from './useAuth'

export interface RedirectLocationState {
  readonly from: ReturnType<typeof useLocation>
}

// Gate for authenticated-only routes. Compose as a layout route:
//   <Route element={<ProtectedRoute />}>
//     <Route path="/my-courses" element={<MyCoursesPage />} />
//   </Route>
export interface ProtectedRouteProps {
  // Optional gate rendered instead of the default <Outlet />.
  readonly children?: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <Spinner label="Verificando sessão..." />
  }

  if (!session) {
    const state: RedirectLocationState = { from: location }
    return <Navigate to="/login" replace state={state} />
  }

  return children ?? <Outlet />
}
