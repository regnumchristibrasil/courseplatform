import { describe, expect, it } from 'vitest'
import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'
import { COURSE_ENTRY_KEY, entryKey, flattenTree, moveModule, nextFocusKey, resolveSelection } from './courseTreeModel'

function lesson(id: string, overrides: Partial<LessonNode> = {}): LessonNode {
  return {
    lessonId: id,
    title: `Aula ${id}`,
    position: 1,
    durationSeconds: null,
    isFreePreview: false,
    archivedAt: null,
    video: { provider: 'youtube', externalRef: 'abc' },
    ...overrides,
  }
}

function module(id: string, lessons: readonly LessonNode[], overrides: Partial<ModuleNode> = {}): ModuleNode {
  return { moduleId: id, title: `Modulo ${id}`, position: 1, archivedAt: null, lessons, ...overrides }
}

function tree(modules: readonly ModuleNode[]): CourseTree {
  return {
    courseId: 'c1',
    title: 'Curso',
    description: null,
    status: 'draft',
    priceCents: 1000,
    accessDurationDays: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    enrollmentCount: 0,
    pendingOrderCount: 0,
    modules,
  }
}

const TREE = tree([
  module('m1', [lesson('l1'), lesson('l2', { archivedAt: '2026-02-01T00:00:00Z', video: null })]),
  module('m2', [], { archivedAt: '2026-02-01T00:00:00Z' }),
])

describe('flattenTree', () => {
  it('lists the course, then each module followed by its lessons, with levels', () => {
    expect(flattenTree(TREE).map((e) => [e.key, e.level])).toEqual([
      ['course', 1],
      ['module:m1', 2],
      ['lesson:l1', 3],
      ['lesson:l2', 3],
      ['module:m2', 2],
    ])
  })

  it('records parent keys and archived/no-video flags', () => {
    const entries = flattenTree(TREE)
    expect(entries.find((e) => e.key === 'lesson:l2')).toMatchObject({ parentKey: 'module:m1', archived: true, missingVideo: true })
    expect(entries.find((e) => e.key === 'lesson:l1')).toMatchObject({ archived: false, missingVideo: false })
    expect(entries.find((e) => e.key === 'module:m2')).toMatchObject({ parentKey: 'course', archived: true })
    expect(entries[0]).toMatchObject({ parentKey: null, label: 'Curso' })
  })

  it('has only the course entry for a course without modules', () => {
    expect(flattenTree(tree([])).map((e) => e.key)).toEqual(['course'])
  })
})

describe('entryKey', () => {
  it('builds stable keys per selection kind', () => {
    expect(entryKey({ kind: 'course' })).toBe(COURSE_ENTRY_KEY)
    expect(entryKey({ kind: 'module', id: 'm1' })).toBe('module:m1')
    expect(entryKey({ kind: 'lesson', id: 'l1' })).toBe('lesson:l1')
  })
})

describe('resolveSelection', () => {
  it('finds the module or lesson node', () => {
    expect(resolveSelection(TREE, { kind: 'course' })).toEqual({ kind: 'course' })
    expect(resolveSelection(TREE, { kind: 'module', id: 'm1' })).toMatchObject({ kind: 'module', module: { moduleId: 'm1' } })
    expect(resolveSelection(TREE, { kind: 'lesson', id: 'l2' })).toMatchObject({
      kind: 'lesson',
      lesson: { lessonId: 'l2' },
      module: { moduleId: 'm1' },
    })
  })

  it('falls back to the course when the item no longer exists', () => {
    expect(resolveSelection(TREE, { kind: 'lesson', id: 'gone' })).toEqual({ kind: 'course' })
    expect(resolveSelection(TREE, { kind: 'module', id: 'gone' })).toEqual({ kind: 'course' })
  })
})

describe('nextFocusKey', () => {
  const entries = flattenTree(TREE)

  it.each([
    ['ArrowDown', 'course', 'module:m1'],
    ['ArrowDown', 'module:m2', 'module:m2'],
    ['ArrowUp', 'module:m1', 'course'],
    ['ArrowUp', 'course', 'course'],
    ['Home', 'lesson:l2', 'course'],
    ['End', 'course', 'module:m2'],
    ['ArrowRight', 'module:m1', 'lesson:l1'],
    ['ArrowRight', 'module:m2', 'module:m2'],
    ['ArrowRight', 'lesson:l1', 'lesson:l1'],
    ['ArrowLeft', 'lesson:l1', 'module:m1'],
    ['ArrowLeft', 'module:m1', 'course'],
    ['ArrowLeft', 'course', 'course'],
  ])('%s from %s moves focus to %s', (key, from, to) => {
    expect(nextFocusKey(entries, from, key)).toBe(to)
  })

  it('returns null for keys it does not handle', () => {
    expect(nextFocusKey(entries, 'course', 'a')).toBeNull()
    expect(nextFocusKey(entries, 'course', 'Tab')).toBeNull()
  })

  it('returns null when the current key is unknown', () => {
    expect(nextFocusKey(entries, 'nope', 'ArrowDown')).toBeNull()
  })
})

describe('moveModule', () => {
  const modules = [module('a', []), module('b', []), module('c', [])]

  it('swaps a module with its neighbour and returns the full id list', () => {
    expect(moveModule(modules, 'b', 'up')).toEqual(['b', 'a', 'c'])
    expect(moveModule(modules, 'b', 'down')).toEqual(['a', 'c', 'b'])
  })

  it('returns null at the edges and for unknown ids', () => {
    expect(moveModule(modules, 'a', 'up')).toBeNull()
    expect(moveModule(modules, 'c', 'down')).toBeNull()
    expect(moveModule(modules, 'zzz', 'up')).toBeNull()
  })

  it('does not mutate the input', () => {
    const snapshot = modules.map((m) => m.moduleId)
    moveModule(modules, 'b', 'up')
    expect(modules.map((m) => m.moduleId)).toEqual(snapshot)
  })
})
