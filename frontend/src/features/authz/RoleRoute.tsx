import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import type { Role } from '../../contracts/adminUsers'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { NotFoundPage } from '../../pages/NotFoundPage'
import { useSessionExpiryHandler } from '../admin/users/useSessionExpiryHandler'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { CURRENT_ACCESS_QUERY_KEY } from './queryKeys'
import { isStaffRole } from './roles'
import { useCurrentAccess } from './useCurrentAccess'

// Guard de UX apenas: o servidor (RPCs/Edge Function) sempre reforça as regras.
// Falha fechada: nunca renderiza conteúdo de equipe sem confirmação.
// Resposta de sucesso não-equipe/inativo -> 404 (decisão 7, não revela a rota);
// erro de carregamento sem dados -> alerta com nova tentativa.
interface StaffGateProps {
  readonly allowed: (role: Role) => boolean
}

function StaffGate({ allowed }: StaffGateProps) {
  const queryClient = useQueryClient()
  const { data, error, isPending, isError, refetch } = useCurrentAccess()
  const handleSessionExpiry = useSessionExpiryHandler()
  const handledError = useRef<unknown>(null)

  // 401 encerra a sessão uma única vez por erro (sem repetir a cada render);
  // o ProtectedRoute redireciona para /login quando a sessão some.
  useEffect(() => {
    if (!error || handledError.current === error) return
    handledError.current = error
    handleSessionExpiry(error)
  }, [error, handleSessionExpiry])

  // Ao entrar na área admin, revalida o papel (rebaixamento recente).
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: CURRENT_ACCESS_QUERY_KEY })
  }, [queryClient])

  if (isPending) {
    return <Spinner label="Verificando permissões..." />
  }
  if (isError && !data) {
    return (
      <Alert variant="error">
        <p>Não foi possível verificar suas permissões.</p>
        <Button variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>
      </Alert>
    )
  }
  if (!data || !data.isActive || !allowed(data.role)) {
    return <NotFoundPage />
  }
  return <Outlet />
}

export interface RoleRouteProps {
  // Predicado de papel; o padrão é admin/superadmin (gestão de usuários).
  readonly allowed?: (role: Role) => boolean
}

// Layout route:
//   <Route element={<RoleRoute />}> <Route path="admin/users" .../> </Route>
//   <Route element={<RoleRoute allowed={isCourseStaffRole} />}> ... </Route>
export function RoleRoute({ allowed = isStaffRole }: RoleRouteProps = {}) {
  return (
    <ProtectedRoute>
      <StaffGate allowed={allowed} />
    </ProtectedRoute>
  )
}
