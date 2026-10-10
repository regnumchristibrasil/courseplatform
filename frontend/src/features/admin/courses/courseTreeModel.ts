import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'

export type TreeSelection =
  | { readonly kind: 'course' }
  | { readonly kind: 'module'; readonly id: string }
  | { readonly kind: 'lesson'; readonly id: string }

export type ResolvedSelection =
  | { readonly kind: 'course' }
  | { readonly kind: 'module'; readonly module: ModuleNode }
  | { readonly kind: 'lesson'; readonly lesson: LessonNode; readonly module: ModuleNode }

export interface TreeEntry {
  readonly key: string
  readonly selection: TreeSelection
  readonly level: 1 | 2 | 3
  readonly label: string
  readonly parentKey: string | null
  readonly archived: boolean
  readonly missingVideo: boolean
}

export const COURSE_ENTRY_KEY = 'course'
export const COURSE_SELECTION: TreeSelection = { kind: 'course' }

export function entryKey(selection: TreeSelection): string {
  return selection.kind === 'course' ? COURSE_ENTRY_KEY : `${selection.kind}:${selection.id}`
}

// Pre-order walk: course, then each module followed by its lessons. This is
// the order keyboard navigation follows (everything is always expanded).
export function flattenTree(tree: CourseTree): readonly TreeEntry[] {
  const course: TreeEntry = {
    key: COURSE_ENTRY_KEY,
    selection: COURSE_SELECTION,
    level: 1,
    label: tree.title,
    parentKey: null,
    archived: tree.status === 'archived',
    missingVideo: false,
  }
  const rest = tree.modules.flatMap((module): readonly TreeEntry[] => {
    const moduleSelection: TreeSelection = { kind: 'module', id: module.moduleId }
    const moduleKey = entryKey(moduleSelection)
    const lessons = module.lessons.map((lesson): TreeEntry => {
      const selection: TreeSelection = { kind: 'lesson', id: lesson.lessonId }
      return {
        key: entryKey(selection),
        selection,
        level: 3,
        label: lesson.title,
        parentKey: moduleKey,
        archived: lesson.archivedAt !== null,
        missingVideo: lesson.video === null,
      }
    })
    const moduleEntry: TreeEntry = {
      key: moduleKey,
      selection: moduleSelection,
      level: 2,
      label: module.title,
      parentKey: COURSE_ENTRY_KEY,
      archived: module.archivedAt !== null,
      missingVideo: false,
    }
    return [moduleEntry, ...lessons]
  })
  return [course, ...rest]
}

// A selection that no longer exists in a refreshed tree falls back to the course.
export function resolveSelection(tree: CourseTree, selection: TreeSelection): ResolvedSelection {
  if (selection.kind === 'module') {
    const module = tree.modules.find((m) => m.moduleId === selection.id)
    return module ? { kind: 'module', module } : { kind: 'course' }
  }
  if (selection.kind === 'lesson') {
    for (const module of tree.modules) {
      const lesson = module.lessons.find((l) => l.lessonId === selection.id)
      if (lesson) return { kind: 'lesson', lesson, module }
    }
  }
  return { kind: 'course' }
}

// WAI-ARIA tree keys over a fully expanded flat list. Returns the key to
// focus, or null when the key is not a navigation key or the origin is unknown.
export function nextFocusKey(entries: readonly TreeEntry[], currentKey: string, pressed: string): string | null {
  const index = entries.findIndex((e) => e.key === currentKey)
  const current = entries[index]
  if (!current) return null
  const last = entries.length - 1
  switch (pressed) {
    case 'ArrowDown':
      return entries[Math.min(index + 1, last)]!.key
    case 'ArrowUp':
      return entries[Math.max(index - 1, 0)]!.key
    case 'Home':
      return entries[0]!.key
    case 'End':
      return entries[last]!.key
    case 'ArrowRight': {
      const next = entries[index + 1]
      return next && next.level === current.level + 1 ? next.key : current.key
    }
    case 'ArrowLeft':
      return current.parentKey ?? current.key
    default:
      return null
  }
}

export const countActive = (items: readonly { readonly archivedAt: string | null }[]): number =>
  items.filter((item) => item.archivedAt === null).length

export const countActiveLessons = (modules: readonly ModuleNode[]): number =>
  modules.reduce((total, module) => total + countActive(module.lessons), 0)
