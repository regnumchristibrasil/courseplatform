import { describe, expect, it } from 'vitest'
import { ROLES } from '../../contracts/adminUsers'
import { isRole, isStaffRole } from './roles'

describe('isRole', () => {
  it.each(ROLES)('accepts %s', (role) => {
    expect(isRole(role)).toBe(true)
  })

  it.each([null, undefined, 42, '', 'root', 'ADMIN'])('rejects %s', (value) => {
    expect(isRole(value)).toBe(false)
  })
})

describe('isStaffRole', () => {
  it.each([
    ['superadmin', true],
    ['admin', true],
    ['tutor', false],
    ['student', false],
  ] as const)('%s -> %s', (role, expected) => {
    expect(isStaffRole(role)).toBe(expected)
  })
})
