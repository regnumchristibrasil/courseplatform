import type { ReactNode } from 'react'
import { Badge } from '../../../components/ui/Badge'
import { EmptyState } from '../../../components/ui/EmptyState'
import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'
import { CourseStatusBadge } from './CourseStatusBadge'
import { countActive, countActiveLessons, type ResolvedSelection } from './courseTreeModel'
import { formatAccessDuration, formatDateTime, formatLessonDuration, formatPrice, PROVIDER_LABELS } from './format'
import styles from './CourseDetailPanel.module.css'

export interface CourseDetailPanelProps {
  readonly tree: CourseTree
  readonly selection: ResolvedSelection
}

function Fields({ children }: { readonly children: ReactNode }) {
  return <dl className={styles.fields}>{children}</dl>
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function CourseDetails({ tree }: { readonly tree: CourseTree }) {
  return (
    <>
      <h2>{tree.title}</h2>
      <Fields>
        <Field label="Status"><CourseStatusBadge status={tree.status} /></Field>
        <Field label="Descrição">{tree.description ?? 'Sem descrição'}</Field>
        <Field label="Preço">{formatPrice(tree.priceCents)}</Field>
        <Field label="Acesso">{formatAccessDuration(tree.accessDurationDays)}</Field>
        <Field label="Matrículas ativas">{tree.enrollmentCount}</Field>
        <Field label="Pedidos pendentes">{tree.pendingOrderCount}</Field>
        <Field label="Módulos ativos">{countActive(tree.modules)}</Field>
        <Field label="Aulas ativas">{countActiveLessons(tree.modules)}</Field>
        <Field label="Criado em">{formatDateTime(tree.createdAt)}</Field>
        <Field label="Atualizado em">{formatDateTime(tree.updatedAt)}</Field>
      </Fields>
      {tree.modules.length === 0 ? <EmptyState title="Este curso ainda não tem módulos." /> : null}
    </>
  )
}

function ModuleDetails({ module }: { readonly module: ModuleNode }) {
  return (
    <>
      <h2>{module.title}</h2>
      <Fields>
        <Field label="Posição">{module.position}</Field>
        <Field label="Situação">
          {module.archivedAt === null ? <Badge variant="success">Ativo</Badge> : <Badge variant="warning">Arquivado</Badge>}
        </Field>
        <Field label="Aulas ativas">{countActive(module.lessons)}</Field>
      </Fields>
      {module.lessons.length === 0 ? <EmptyState title="Este módulo ainda não tem aulas." /> : null}
    </>
  )
}

function LessonDetails({ lesson, module }: { readonly lesson: LessonNode; readonly module: ModuleNode }) {
  return (
    <>
      <h2>{lesson.title}</h2>
      <Fields>
        <Field label="Módulo">{module.title}</Field>
        <Field label="Posição">{lesson.position}</Field>
        <Field label="Duração">{formatLessonDuration(lesson.durationSeconds)}</Field>
        <Field label="Prévia gratuita">{lesson.isFreePreview ? 'Sim' : 'Não'}</Field>
        <Field label="Situação">
          {lesson.archivedAt === null ? <Badge variant="success">Ativa</Badge> : <Badge variant="warning">Arquivada</Badge>}
        </Field>
        <Field label="Vídeo">
          {lesson.video === null ? (
            <Badge variant="danger">Sem vídeo ativo</Badge>
          ) : (
            <>
              {PROVIDER_LABELS[lesson.video.provider]}: <code>{lesson.video.externalRef}</code>
            </>
          )}
        </Field>
      </Fields>
    </>
  )
}

// Read-only detail of the selected tree item. Editing arrives in later tickets.
export function CourseDetailPanel({ tree, selection }: CourseDetailPanelProps) {
  return (
    <section aria-label="Detalhes do item selecionado" className={styles.panel}>
      {selection.kind === 'course' ? <CourseDetails tree={tree} /> : null}
      {selection.kind === 'module' ? <ModuleDetails module={selection.module} /> : null}
      {selection.kind === 'lesson' ? <LessonDetails lesson={selection.lesson} module={selection.module} /> : null}
    </section>
  )
}
