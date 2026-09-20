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
export function ProtectedRoute() {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <Spinner label="Verificando sessão..." />
  }

  if (!session) {
    const state: RedirectLocationState = { from: location }
    return <Navigate to="/login" replace state={state} />
  }

  return <Outlet />
}
