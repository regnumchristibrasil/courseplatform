import { describe, expect, it } from 'vitest'
import { COURSE_ACTIONS, COURSE_ROLES } from '../../contracts/adminCourses'
import { canPerformCourseAction, isCourseStaffRole } from './coursePermissions'

describe('isCourseStaffRole', () => {
  it.each([
    ['superadmin', true],
    ['admin', true],
    ['tutor', true],
    ['student', false],
  ] as const)('%s -> %s', (role, expected) => {
    expect(isCourseStaffRole(role)).toBe(expected)
  })
})

describe('canPerformCourseAction', () => {
  it('tutor cannot change price or access duration', () => {
    expect(canPerformCourseAction('tutor', 'edit_price')).toBe(false)
    expect(canPerformCourseAction('tutor', 'edit_access_duration')).toBe(false)
    expect(canPerformCourseAction('tutor', 'edit_content')).toBe(true)
  })

  it('admin and superadmin can do everything', () => {
    for (const action of COURSE_ACTIONS) {
      expect(canPerformCourseAction('admin', action)).toBe(true)
      expect(canPerformCourseAction('superadmin', action)).toBe(true)
    }
  })

  it('student can do nothing', () => {
    for (const action of COURSE_ACTIONS) expect(canPerformCourseAction('student', action)).toBe(false)
  })

  it('covers every role', () => {
    expect(COURSE_ROLES).toHaveLength(4)
  })
})
