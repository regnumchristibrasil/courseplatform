import { describe, expect, it } from 'vitest'
import type { CourseTree } from '../../contracts/studentArea'
import { findLessonContext } from './lessonContext'

const tree: CourseTree = {
  courseId: 'c1',
  title: 'Curso',
  description: null,
  courseStatus: 'published',
  isStaff: false,
  totalLessons: 4,
  completedLessons: 0,
  progressPercent: 0,
  totalDurationSeconds: 0,
  continueLessonId: 'l1',
  modules: [
    {
      id: 'm1',
      title: 'M1',
      lessons: [
        { id: 'l1', title: 'A1', durationSeconds: null, state: 'not_started' },
        { id: 'l2', title: 'A2', durationSeconds: null, state: 'not_started' },
      ],
    },
    { id: 'm2', title: 'M2', lessons: [{ id: 'l3', title: 'A3', durationSeconds: null, state: 'not_started' }] },
    { id: 'm3', title: 'M3 vazio', lessons: [] },
    { id: 'm4', title: 'M4', lessons: [{ id: 'l4', title: 'A4', durationSeconds: null, state: 'not_started' }] },
  ],
}

describe('findLessonContext', () => {
  it('returns the lesson, its module and the previous/next within the module', () => {
    const ctx = findLessonContext(tree, 'l2')
    expect(ctx?.lesson.id).toBe('l2')
    expect(ctx?.module.id).toBe('m1')
    expect(ctx?.previous?.id).toBe('l1')
    expect(ctx?.next?.id).toBe('l3')
  })

  it('has no previous on the first lesson of the course', () => {
    expect(findLessonContext(tree, 'l1')?.previous).toBeNull()
  })

  it('crosses module boundaries and skips empty modules', () => {
    const ctx = findLessonContext(tree, 'l3')
    expect(ctx?.previous?.id).toBe('l2')
    expect(ctx?.next?.id).toBe('l4')
  })

  it('has no next on the last lesson of the course', () => {
    expect(findLessonContext(tree, 'l4')?.next).toBeNull()
  })

  it('returns null for a lesson that is not in the tree (archived or unknown)', () => {
    expect(findLessonContext(tree, 'nope')).toBeNull()
  })
})
