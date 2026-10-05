import { describe, expect, it } from 'vitest'
import { PERMISSION_MATRIX, ROLES } from '../../contracts/adminUsers'
import { assignableRoles, canChangeRole, canPerform, canToggleActive } from './permissions'

describe('canPerform against the shared matrix fixture', () => {
  it.each(PERMISSION_MATRIX.map((row) => [row] as const))(
    'row %j',
    (row) => {
      const result = canPerform({
        actorId: 'actor',
        actorRole: row.actor,
        targetId: 'target',
        targetRole: row.target,
        action: row.action,
        newRole: row.newRole,
      })
      expect(result).toBe(row.allowed)
    },
  )

  it.each(ROLES)('denies %s acting on itself', (role) => {
    expect(
      canPerform({
        actorId: 'same',
        actorRole: role,
        targetId: 'same',
        targetRole: role,
        action: 'set_active',
        newRole: null,
      }),
    ).toBe(false)
  })

  it('allows a superadmin to act on another superadmin', () => {
    expect(
      canPerform({
        actorId: 'a',
        actorRole: 'superadmin',
        targetId: 'b',
        targetRole: 'superadmin',
        action: 'set_role',
        newRole: 'admin',
      }),
    ).toBe(true)
  })
})

const ctx = (actorRole: (typeof ROLES)[number], targetRole: (typeof ROLES)[number], targetId = 'target') => ({
  actorId: 'actor',
  actorRole,
  targetId,
  targetRole,
})

describe('assignableRoles', () => {
  it('lists only the other student/tutor role for an admin over a student', () => {
    expect(assignableRoles(ctx('admin', 'student'))).toEqual(['tutor'])
  })

  it('lists every other role for a superadmin', () => {
    expect(assignableRoles(ctx('superadmin', 'admin'))).toEqual(['superadmin', 'tutor', 'student'])
  })

  it('lists nothing when the actor cannot manage the target', () => {
    expect(assignableRoles(ctx('admin', 'admin'))).toEqual([])
    expect(assignableRoles(ctx('tutor', 'student'))).toEqual([])
  })

  it('lists nothing when the target is the actor (self rule comes from the contract)', () => {
    expect(assignableRoles(ctx('superadmin', 'tutor', 'actor'))).toEqual([])
  })
})

describe('canChangeRole / canToggleActive', () => {
  it('allow a superadmin on another user', () => {
    expect(canChangeRole(ctx('superadmin', 'student'))).toBe(true)
    expect(canToggleActive(ctx('superadmin', 'student'))).toBe(true)
  })

  it('deny acting on oneself', () => {
    expect(canChangeRole(ctx('superadmin', 'student', 'actor'))).toBe(false)
    expect(canToggleActive(ctx('superadmin', 'student', 'actor'))).toBe(false)
  })

  it('deny an admin on an admin target', () => {
    expect(canChangeRole(ctx('admin', 'admin'))).toBe(false)
    expect(canToggleActive(ctx('admin', 'admin'))).toBe(false)
  })

  it('allow an admin to toggle a tutor', () => {
    expect(canToggleActive(ctx('admin', 'tutor'))).toBe(true)
  })
})
