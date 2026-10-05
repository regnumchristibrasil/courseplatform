import { assert, assertEquals } from '@std/assert';
import { mapRpcError, SQLSTATE_TO_CODE } from '../supabase/functions/admin-users/map-rpc-error.ts';
import {
  ADMIN_USERS_ERROR_STATUS,
  type AdminUserAction,
  type AdminUsersErrorCode,
  evaluatePermission,
  PERMISSION_MATRIX,
  ROLE_RANK,
  ROLES,
} from './adminUsers.ts';

const SELF = 'user-a';
const OTHER = 'user-b';

Deno.test('ROLE_RANK orders superadmin > admin > tutor > student', () => {
  assert(ROLE_RANK.superadmin > ROLE_RANK.admin);
  assert(ROLE_RANK.admin > ROLE_RANK.tutor);
  assert(ROLE_RANK.tutor > ROLE_RANK.student);
});

Deno.test('matrix covers every actor x target x action (x new role for set_role)', () => {
  const n = ROLES.length;
  assertEquals(PERMISSION_MATRIX.length, n * n * (n + 1));
});

Deno.test('admin cannot touch admin or superadmin targets, nor assign those roles', () => {
  for (const row of PERMISSION_MATRIX.filter((r) => r.actor === 'admin')) {
    const touchesPrivileged = row.target === 'admin' || row.target === 'superadmin';
    const assignsPrivileged = row.newRole === 'admin' || row.newRole === 'superadmin';
    if (touchesPrivileged || assignsPrivileged) assertEquals(row.allowed, false);
  }
});

Deno.test('admin can manage student/tutor targets', () => {
  const rows = PERMISSION_MATRIX.filter((r) =>
    r.actor === 'admin' && (r.target === 'student' || r.target === 'tutor') &&
    (r.newRole === null || r.newRole === 'student' || r.newRole === 'tutor')
  );
  assert(rows.length > 0);
  for (const row of rows) assertEquals(row.allowed, true);
});

Deno.test('tutor and student can never act', () => {
  for (const row of PERMISSION_MATRIX.filter((r) => r.actor === 'tutor' || r.actor === 'student')) {
    assertEquals(row.allowed, false);
  }
});

Deno.test('superadmin can do everything on other users', () => {
  for (const row of PERMISSION_MATRIX.filter((r) => r.actor === 'superadmin')) {
    assertEquals(row.allowed, true);
  }
});

Deno.test('nobody targets self, regardless of role or action', () => {
  for (const actor of ROLES) {
    for (const action of ['set_role', 'set_active'] as AdminUserAction[]) {
      const result = evaluatePermission({
        actorId: SELF,
        actorRole: actor,
        targetId: SELF,
        targetRole: actor,
        action,
        newRole: action === 'set_role' ? 'student' : null,
      });
      assertEquals(result, { allowed: false, error: 'self_target' });
    }
  }
});

Deno.test('evaluatePermission agrees with the matrix for distinct users', () => {
  for (const row of PERMISSION_MATRIX) {
    const result = evaluatePermission({
      actorId: SELF,
      actorRole: row.actor,
      targetId: OTHER,
      targetRole: row.target,
      action: row.action,
      newRole: row.newRole,
    });
    assertEquals(result.allowed, row.allowed, JSON.stringify(row));
    if (!result.allowed) assertEquals(result.error, 'forbidden');
  }
});

Deno.test('every contract DbErrorCode has a SQLSTATE and an HTTP status in map-rpc-error', () => {
  const dbCodes = Object.keys(ADMIN_USERS_ERROR_STATUS).filter((c) => c !== 'auth_sync_failed');
  assertEquals(dbCodes.length, Object.keys(SQLSTATE_TO_CODE).length);
  for (const code of dbCodes) {
    const sqlstate = Object.entries(SQLSTATE_TO_CODE).find(([, c]) => c === code)?.[0];
    assert(sqlstate !== undefined, `no SQLSTATE for ${code}`);
    const mapped = mapRpcError({ message: code });
    assertEquals(mapped?.status, ADMIN_USERS_ERROR_STATUS[code as AdminUsersErrorCode], code);
    assertEquals(mapRpcError({ message: 'x', code: sqlstate })?.code, code);
  }
});

Deno.test('auth_sync_failed is Edge-Function-only: no SQLSTATE maps to it', () => {
  assertEquals(Object.values(SQLSTATE_TO_CODE).includes('auth_sync_failed' as never), false);
  assertEquals(ADMIN_USERS_ERROR_STATUS.auth_sync_failed, 502);
});
