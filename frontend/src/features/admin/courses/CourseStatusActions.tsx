import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { COURSE_STATUS_TRANSITIONS, type CourseStatus, type CourseTree } from '../../../contracts/adminCourses'
import { AdminCoursesApiError } from './api'
import { describeGateViolation } from './gateViolations'
import { describeStatusError, GATE_INTRO } from './statusErrors'
import { useCourseStatusAction } from './useCourseStatusAction'
import styles from './ModuleActions.module.css'

const TRANSITION_LABELS: Readonly<Record<CourseStatus, string>> = {
  draft: 'Voltar para rascunho',
  published: 'Publicar',
  archived: 'Arquivar',
}

function lessonTitles(tree: CourseTree): ReadonlyMap<string, string> {
  return new Map(tree.modules.flatMap((module) => module.lessons.map((lesson): [string, string] => [lesson.lessonId, lesson.title])))
}

function GateViolations({ error, tree }: { readonly error: AdminCoursesApiError; readonly tree: CourseTree }) {
  if (error.violations.length === 0) return <Alert variant="error">{describeStatusError(error)}</Alert>
  const titles = lessonTitles(tree)
  return (
    <Alert variant="error">
      <p>{GATE_INTRO}</p>
      <ul aria-label="Pendências para publicar">
        {error.violations.map((violation, index) => (
          <li key={`${violation.code}-${violation.lessonId ?? index}`}>{describeGateViolation(violation, titles)}</li>
        ))}
      </ul>
    </Alert>
  )
}

export interface CourseStatusActionsProps {
  readonly tree: CourseTree
  readonly canChangeStatus: boolean
  readonly canDelete: boolean
}

// Course-level: status transitions (only the allowed ones) and delete with confirmation.
export function CourseStatusActions({ tree, canChangeStatus, canDelete }: CourseStatusActionsProps) {
  const action = useCourseStatusAction()
  const navigate = useNavigate()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const pending = action.isPending
  const hasSales = tree.enrollmentCount > 0 || tree.pendingOrderCount > 0
  const error = action.isError ? action.error : null
  const gateError = error instanceof AdminCoursesApiError && error.code === 'publish_gate_violated' ? error : null

  if (!canChangeStatus && !canDelete) return null

  return (
    <section aria-label="Status do curso">
      {error && !confirmingDelete ? (
        gateError ? <GateViolations error={gateError} tree={tree} /> : <Alert variant="error">{describeStatusError(error)}</Alert>
      ) : null}
      <div className={styles.actions}>
        {canChangeStatus
          ? COURSE_STATUS_TRANSITIONS[tree.status].map((status) => (
            <Button
              key={status}
              variant="secondary"
              disabled={pending}
              onClick={() => action.mutate({ kind: 'status', courseId: tree.courseId, expectedUpdatedAt: tree.updatedAt, status })}
            >
              {TRANSITION_LABELS[status]}
            </Button>
          ))
          : null}
        {canDelete ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              action.reset()
              setConfirmingDelete(true)
            }}
          >
            Excluir curso
          </Button>
        ) : null}
      </div>
      <Dialog
        open={confirmingDelete}
        title="Excluir curso"
        dismissible={!pending}
        panelClassName="ph-no-capture"
        onClose={() => setConfirmingDelete(false)}
        description={<>Excluir o curso <strong>{tree.title}</strong>? Esta ação não pode ser desfeita e remove seus módulos e aulas.</>}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={pending} onClick={() => setConfirmingDelete(false)}>Cancelar</Button>
            <Button
              variant="danger"
              isLoading={pending}
              onClick={() =>
                action.mutate(
                  { kind: 'delete', courseId: tree.courseId, expectedUpdatedAt: tree.updatedAt },
                  { onSuccess: () => navigate('/admin/courses') },
                )}
            >
              Excluir
            </Button>
          </>
        }
      >
        {hasSales ? <Alert variant="warning">Este curso tem matrículas ou pedidos e não pode ser excluído. Arquive-o em vez disso.</Alert> : null}
        {error ? <Alert variant="error">{describeStatusError(error)}</Alert> : null}
      </Dialog>
    </section>
  )
}
