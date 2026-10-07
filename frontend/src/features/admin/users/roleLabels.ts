import type { Role } from '../../../contracts/adminUsers'

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  superadmin: 'Superadministrador',
  admin: 'Administrador',
  tutor: 'Tutor',
  student: 'Aluno',
}

export function statusLabel(isActive: boolean): string {
  return isActive ? 'Ativo' : 'Inativo'
}
