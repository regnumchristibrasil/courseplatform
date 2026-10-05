import { ROLE_RANK, ROLES, type Role } from '../../contracts/adminUsers'

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

// Equipe = papeis que acessam a area administrativa (admin e superadmin).
export function isStaffRole(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.admin
}
