import { ROLES, evaluatePermission, type PermissionInput, type Role } from '../../contracts/adminUsers'

// UX apenas: o servidor (RPCs / Edge Function) reforça toda regra novamente.
// Nenhuma regra é duplicada aqui; tudo delega para evaluatePermission, que
// inclui a regra de "ator nunca é o alvo" (ids reais, sem sentinelas).
export interface PermissionContext {
  readonly actorId: string
  readonly actorRole: Role
  readonly targetId: string
  readonly targetRole: Role
}

export function canPerform(input: PermissionInput): boolean {
  return evaluatePermission(input).allowed
}

// Papéis que o ator pode atribuir ao alvo, exceto o papel atual do alvo.
export function assignableRoles(context: PermissionContext): readonly Role[] {
  return ROLES.filter(
    (newRole) =>
      newRole !== context.targetRole && canPerform({ ...context, action: 'set_role', newRole }),
  )
}

export function canChangeRole(context: PermissionContext): boolean {
  return assignableRoles(context).length > 0
}

export function canToggleActive(context: PermissionContext): boolean {
  return canPerform({ ...context, action: 'set_active', newRole: null })
}
