import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CourseTree } from '../../../contracts/adminCourses'
import { CourseTreeView } from './CourseTreeView'
import { COURSE_SELECTION, type TreeSelection } from './courseTreeModel'

const TREE: CourseTree = {
  courseId: 'c1',
  title: 'Curso A',
  description: null,
  status: 'published',
  priceCents: 1000,
  accessDurationDays: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  enrollmentCount: 0,
  pendingOrderCount: 0,
  modules: [
    {
      moduleId: 'm1',
      title: 'Modulo 1',
      position: 1,
      archivedAt: null,
      lessons: [
        { lessonId: 'l1', title: 'Aula 1', position: 1, durationSeconds: null, isFreePreview: false, archivedAt: null, updatedAt: '2026-01-03T10:00:00Z', video: { provider: 'youtube', externalRef: 'x' } },
        { lessonId: 'l2', title: 'Aula 2', position: 2, durationSeconds: null, isFreePreview: false, archivedAt: '2026-02-01T00:00:00Z', updatedAt: '2026-01-03T10:00:00Z', video: null },
      ],
    },
    { moduleId: 'm2', title: 'Modulo 2', position: 2, archivedAt: '2026-02-01T00:00:00Z', lessons: [] },
  ],
}

function setup(selection: TreeSelection = COURSE_SELECTION) {
  const onSelect = vi.fn()
  render(<CourseTreeView tree={TREE} selection={selection} onSelect={onSelect} />)
  return { onSelect, user: userEvent.setup() }
}

describe('CourseTreeView', () => {
  it('renders the course, modules and lessons as a labelled tree with levels', () => {
    setup()

    expect(screen.getByRole('tree', { name: 'Estrutura do curso' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /Curso A/ })).toHaveAttribute('aria-level', '1')
    expect(screen.getByRole('treeitem', { name: /Modulo 1/ })).toHaveAttribute('aria-level', '2')
    expect(screen.getByRole('treeitem', { name: /Aula 1/ })).toHaveAttribute('aria-level', '3')
    expect(screen.getAllByRole('treeitem')).toHaveLength(5)
  })

  it('marks the selected item and only that one', () => {
    setup({ kind: 'lesson', id: 'l1' })

    expect(screen.getByRole('treeitem', { name: /Aula 1/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('treeitem', { name: /Curso A/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('marks archived items and lessons without video', () => {
    setup()

    expect(screen.getByRole('treeitem', { name: /Aula 2/ })).toHaveTextContent('Arquivada')
    expect(screen.getByRole('treeitem', { name: /Aula 2/ })).toHaveTextContent('Sem vídeo')
    expect(screen.getByRole('treeitem', { name: /Modulo 2/ })).toHaveTextContent('Arquivado')
    expect(screen.getByRole('treeitem', { name: /Aula 1/ })).not.toHaveTextContent('Sem vídeo')
  })

  it('selects an item on click', async () => {
    const { onSelect, user } = setup()

    await user.click(screen.getByRole('treeitem', { name: /Aula 1/ }))

    expect(onSelect).toHaveBeenCalledWith({ kind: 'lesson', id: 'l1' })
  })

  it('has a single tab stop on the selected item', () => {
    setup({ kind: 'module', id: 'm1' })

    const stops = screen.getAllByRole('treeitem').filter((el) => el.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveTextContent('Modulo 1')
  })

  it('moves focus with the arrow keys without selecting', async () => {
    const { onSelect, user } = setup()

    await user.tab()
    expect(screen.getByRole('treeitem', { name: /Curso A/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('treeitem', { name: /Modulo 1/ })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('treeitem', { name: /Aula 1/ })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('treeitem', { name: /Modulo 1/ })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('treeitem', { name: /Modulo 2/ })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('treeitem', { name: /Curso A/ })).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each(['{Enter}', ' '])('selects the focused item with %j', async (key) => {
    const { onSelect, user } = setup()

    await user.tab()
    await user.keyboard('{ArrowDown}')
    await user.keyboard(key)

    expect(onSelect).toHaveBeenCalledWith({ kind: 'module', id: 'm1' })
  })

  it('leaves unrelated keys alone', async () => {
    const { onSelect, user } = setup()

    await user.tab()
    await user.keyboard('a')

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('treeitem', { name: /Curso A/ })).toHaveFocus()
  })
})
