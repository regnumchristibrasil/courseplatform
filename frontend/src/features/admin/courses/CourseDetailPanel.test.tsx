import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'
import { CourseDetailPanel } from './CourseDetailPanel'
import { resolveSelection, type TreeSelection } from './courseTreeModel'

const LESSON_YT: LessonNode = { lessonId: 'l1', title: 'Aula 1', position: 1, durationSeconds: 600, isFreePreview: true, archivedAt: null, video: { provider: 'youtube', externalRef: 'dQw4w9WgXcQ' } }
const LESSON_PANDA: LessonNode = { lessonId: 'l2', title: 'Aula 2', position: 2, durationSeconds: null, isFreePreview: false, archivedAt: '2026-02-01T00:00:00Z', video: { provider: 'panda', externalRef: '3f1c9a52-0000-4000-8000-000000000001' } }
const LESSON_NONE: LessonNode = { lessonId: 'l3', title: 'Aula 3', position: 3, durationSeconds: null, isFreePreview: false, archivedAt: null, video: null }
const MODULE: ModuleNode = { moduleId: 'm1', title: 'Modulo 1', position: 1, archivedAt: null, lessons: [LESSON_YT, LESSON_PANDA, LESSON_NONE] }
const MODULE_EMPTY: ModuleNode = { moduleId: 'm2', title: 'Modulo 2', position: 2, archivedAt: '2026-02-01T00:00:00Z', lessons: [] }

function tree(overrides: Partial<CourseTree> = {}): CourseTree {
  return {
    courseId: 'c1',
    title: 'Curso A',
    description: 'Uma descricao',
    status: 'published',
    priceCents: 19900,
    accessDurationDays: 90,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    enrollmentCount: 4,
    pendingOrderCount: 2,
    modules: [MODULE, MODULE_EMPTY],
    ...overrides,
  }
}

function show(selection: TreeSelection, t: CourseTree = tree()) {
  render(<CourseDetailPanel tree={t} selection={resolveSelection(t, selection)} />)
  return screen.getByRole('region', { name: 'Detalhes do item selecionado' })
}

describe('CourseDetailPanel', () => {
  it('shows course details', () => {
    const panel = show({ kind: 'course' })

    expect(within(panel).getByRole('heading', { name: 'Curso A' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('Publicado')
    expect(panel).toHaveTextContent('Uma descricao')
    expect(panel).toHaveTextContent('R$ 199,00')
    expect(panel).toHaveTextContent('90 dias')
    expect(within(panel).getByText('Matrículas ativas').nextSibling).toHaveTextContent('4')
    expect(within(panel).getByText('Pedidos pendentes').nextSibling).toHaveTextContent('2')
    expect(within(panel).getByText('Módulos ativos').nextSibling).toHaveTextContent('1')
    expect(within(panel).getByText('Aulas ativas').nextSibling).toHaveTextContent('2')
  })

  it('shows a placeholder for a missing description', () => {
    const panel = show({ kind: 'course' }, tree({ description: null }))

    expect(panel).toHaveTextContent('Sem descrição')
  })

  it('shows an empty state for a course without modules', () => {
    const panel = show({ kind: 'course' }, tree({ modules: [] }))

    expect(panel).toHaveTextContent('Este curso ainda não tem módulos.')
  })

  it('shows module details with its lesson count', () => {
    const panel = show({ kind: 'module', id: 'm1' })

    expect(within(panel).getByRole('heading', { name: 'Modulo 1' })).toBeInTheDocument()
    expect(within(panel).getByText('Posição').nextSibling).toHaveTextContent('1')
    expect(within(panel).getByText('Situação').nextSibling).toHaveTextContent('Ativo')
    expect(within(panel).getByText('Aulas ativas').nextSibling).toHaveTextContent('2')
  })

  it('marks an archived module and shows the empty module state', () => {
    const panel = show({ kind: 'module', id: 'm2' })

    expect(within(panel).getByText('Situação').nextSibling).toHaveTextContent('Arquivado')
    expect(panel).toHaveTextContent('Este módulo ainda não tem aulas.')
  })

  it('shows lesson details with the YouTube video reference', () => {
    const panel = show({ kind: 'lesson', id: 'l1' })

    expect(within(panel).getByRole('heading', { name: 'Aula 1' })).toBeInTheDocument()
    expect(within(panel).getByText('Módulo').nextSibling).toHaveTextContent('Modulo 1')
    expect(within(panel).getByText('Duração').nextSibling).toHaveTextContent('10:00')
    expect(within(panel).getByText('Prévia gratuita').nextSibling).toHaveTextContent('Sim')
    expect(within(panel).getByText('Situação').nextSibling).toHaveTextContent('Ativa')
    expect(within(panel).getByText('Vídeo').nextSibling).toHaveTextContent('YouTube')
    expect(within(panel).getByText('Vídeo').nextSibling).toHaveTextContent('dQw4w9WgXcQ')
  })

  it('shows an archived lesson with its Panda video', () => {
    const panel = show({ kind: 'lesson', id: 'l2' })

    expect(within(panel).getByText('Situação').nextSibling).toHaveTextContent('Arquivada')
    expect(within(panel).getByText('Prévia gratuita').nextSibling).toHaveTextContent('Não')
    expect(within(panel).getByText('Duração').nextSibling).toHaveTextContent('Não informada')
    expect(within(panel).getByText('Vídeo').nextSibling).toHaveTextContent('Panda Video')
    expect(within(panel).getByText('Vídeo').nextSibling).toHaveTextContent('3f1c9a52-0000-4000-8000-000000000001')
  })

  it('says when a lesson has no active video', () => {
    const panel = show({ kind: 'lesson', id: 'l3' })

    expect(within(panel).getByText('Vídeo').nextSibling).toHaveTextContent('Sem vídeo ativo')
  })
})
