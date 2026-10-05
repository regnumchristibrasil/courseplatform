// Admin user management contract, shared verbatim between frontend and
// backend (see .claude/plans/admin-user-management.md). The permission
// matrix mirrors the server-side invariants (I1, I4) and decision 4:
// - I1: the actor is never the target.
// - I4: actor rank must be strictly greater than the target's current rank
//   and than the new role.
// - Decision 4: admins only manage student/tutor targets and only assign
//   student/tutor. Only a superadmin touches admin/superadmin (peer
//   superadmins included, which is the one exception to strict I4).
// Client-side guards are UX only; the database/Edge Function re-checks all.

export type Role = 'superadmin' | 'admin' | 'tutor' | 'student';

export const ROLES: readonly Role[] = ['superadmin', 'admin', 'tutor', 'student'];

export const ROLE_RANK: Readonly<Record<Role, number>> = {
  superadmin: 4,
  admin: 3,
  tutor: 2,
  student: 1,
};

export const MAX_LIST_LIMIT = 50;
export const MAX_REASON_LENGTH = 500;

export interface ListUsersRequest {
  readonly search?: string;
  readonly role?: Role;
  readonly active?: boolean;
  readonly limit: number; // 1..MAX_LIST_LIMIT
  readonly offset: number; // >= 0
}

export interface AdminUserRow {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly role: Role;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface ListUsersResponse {
  readonly users: readonly AdminUserRow[];
  readonly total: number;
}

export interface SetRoleRequest {
  readonly userId: string;
  readonly role: Role;
  readonly expectedRole: Role;
  readonly reason?: string;
}

export interface SetActiveRequest {
  readonly userId: string;
  readonly active: boolean;
  readonly expectedActive: boolean;
  readonly reason?: string; // <= MAX_REASON_LENGTH
}

export interface SetRoleResponse {
  readonly userId: string;
  readonly role: Role;
}

export interface SetActiveResponse {
  readonly userId: string;
  readonly isActive: boolean;
}

// Shape returned by app.current_access().
export interface CurrentAccess {
  readonly role: Role;
  readonly isActive: boolean;
}

export type AdminUsersErrorCode =
  | 'stale_target'
  | 'forbidden'
  | 'self_target'
  | 'last_superadmin'
  | 'actor_inactive'
  | 'invalid_input'
  | 'auth_sync_failed'
  | 'not_found';

// ATENCAO: o status HTTP DIFERE entre a RPC direta (PostgREST, que responde
// com o proprio mapeamento de SQLSTATE) e a Edge Function (esta tabela).
// Clientes devem decidir pelo codigo estavel em error.message / error.code
// (AdminUsersErrorCode), NUNCA pelo status HTTP.
export const ADMIN_USERS_ERROR_STATUS: Readonly<Record<AdminUsersErrorCode, number>> = {
  stale_target: 409,
  forbidden: 403,
  self_target: 403,
  last_superadmin: 409,
  actor_inactive: 403,
  invalid_input: 400,
  auth_sync_failed: 502,
  not_found: 404,
};

export interface AdminUsersError {
  readonly code: AdminUsersErrorCode;
  readonly message: string;
}

export type AdminUserAction = 'set_role' | 'set_active';

export interface PermissionInput {
  readonly actorId: string;
  readonly actorRole: Role;
  readonly targetId: string;
  readonly targetRole: Role;
  readonly action: AdminUserAction;
  readonly newRole: Role | null; // required for set_role, null for set_active
}

export type PermissionResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: 'self_target' | 'forbidden' };

const ADMIN_MANAGEABLE: readonly Role[] = ['student', 'tutor'];

// Pure rule check, usable by the guard layer on both sides. Role/status
// preconditions (actor_inactive, last_superadmin, stale_target) are
// server-only and not modelled here.
export function evaluatePermission(input: PermissionInput): PermissionResult {
  if (input.actorId === input.targetId) return { allowed: false, error: 'self_target' };
  if (input.actorRole === 'superadmin') return { allowed: true };
  if (input.actorRole !== 'admin') return { allowed: false, error: 'forbidden' };
  const targetOk = ADMIN_MANAGEABLE.includes(input.targetRole);
  const roleOk = input.action === 'set_active' ||
    (input.newRole !== null && ADMIN_MANAGEABLE.includes(input.newRole));
  return targetOk && roleOk ? { allowed: true } : { allowed: false, error: 'forbidden' };
}

export interface PermissionMatrixRow {
  readonly actor: Role;
  readonly target: Role;
  readonly action: AdminUserAction;
  readonly newRole: Role | null;
  readonly allowed: boolean;
}

// Explicit expectation table (actor role x target role x action [x new
// role]) for distinct users, written from the rules above rather than from
// evaluatePermission so the tests are not circular.
const MATRIX_POLICY: Readonly<
  Record<Role, { readonly targets: readonly Role[]; readonly assignable: readonly Role[] }>
> = {
  superadmin: { targets: ROLES, assignable: ROLES },
  admin: { targets: ADMIN_MANAGEABLE, assignable: ADMIN_MANAGEABLE },
  tutor: { targets: [], assignable: [] },
  student: { targets: [], assignable: [] },
};

export const PERMISSION_MATRIX: readonly PermissionMatrixRow[] = ROLES.flatMap((actor) =>
  ROLES.flatMap((target) => {
    const policy = MATRIX_POLICY[actor];
    const targetOk = policy.targets.includes(target);
    const activeRow: PermissionMatrixRow = {
      actor,
      target,
      action: 'set_active',
      newRole: null,
      allowed: targetOk,
    };
    const roleRows = ROLES.map((newRole): PermissionMatrixRow => ({
      actor,
      target,
      action: 'set_role',
      newRole,
      allowed: targetOk && policy.assignable.includes(newRole),
    }));
    return [activeRow, ...roleRows];
  })
);
