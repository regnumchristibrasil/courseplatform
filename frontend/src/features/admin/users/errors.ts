import type { AdminUsersErrorCode } from '../../../contracts/adminUsers'

// 'internal' é o código genérico local para erros desconhecidos/transporte.
// 'unauthorized' é local à UI (HTTP 401): sessão expirada; fora do contrato.
export type AdminUsersUiErrorCode = AdminUsersErrorCode | 'internal' | 'unauthorized'

export type AdminUsersErrorAction = 'retry' | 'reload' | 'none'

export interface AdminUsersErrorView {
  readonly message: string
  readonly action: AdminUsersErrorAction
}

const VIEWS: Readonly<Record<AdminUsersUiErrorCode, AdminUsersErrorView>> = {
  stale_target: {
    message: 'Este usuário foi alterado por outra pessoa. Recarregue a lista e tente novamente.',
    action: 'reload',
  },
  forbidden: {
    message: 'Você não tem permissão para realizar esta ação.',
    action: 'none',
  },
  self_target: {
    message: 'Você não pode alterar a sua própria conta.',
    action: 'none',
  },
  last_superadmin: {
    message: 'Não é possível remover ou desativar o último superadministrador.',
    action: 'none',
  },
  actor_inactive: {
    message: 'Sua conta está inativa e não pode realizar esta ação.',
    action: 'none',
  },
  invalid_input: {
    message: 'Os dados informados são inválidos. Revise e tente novamente.',
    action: 'none',
  },
  auth_sync_failed: {
    message: 'A alteração foi salva, mas a sincronização com a autenticação falhou. Tente novamente.',
    action: 'retry',
  },
  not_found: {
    message: 'Usuário não encontrado. Recarregue a lista.',
    action: 'none',
  },
  unauthorized: {
    message: 'Sua sessão expirou. Entre novamente.',
    action: 'none',
  },
  internal: {
    message: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
    action: 'none',
  },
}

export function describeAdminUsersError(code: AdminUsersUiErrorCode): AdminUsersErrorView {
  return VIEWS[code]
}
