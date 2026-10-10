import { useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Select } from '../../../components/ui/Select'
import type { CourseTree, LessonNode, ModuleNode } from '../../../contracts/adminCourses'
import { moveLesson, otherModulesOfCourse } from './courseTreeModel'
import { describeLessonError } from './lessonErrors'
import { LessonForm } from './LessonForm'
import { useLessonAction } from './useLessonAction'
import styles from './ModuleActions.module.css'

export interface AddLessonActionProps {
  readonly module: ModuleNode
  readonly courseStatus: CourseTree['status']
}

// Module-level: append a lesson. On a published course the editor defaults to
// creating it archived, since a new lesson has no video yet (publish gate).
export function AddLessonAction({ module, courseStatus }: AddLessonActionProps) {
  const action = useLessonAction()
  const [open, setOpen] = useState(false)
  const published = courseStatus === 'published'

  if (!open) {
    return (
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setOpen(true)}>Adicionar aula</Button>
      </div>
    )
  }
  return (
    <>
      {published ? (
        <p className={styles.hint}>Curso publicado: uma aula ativa precisa de vídeo, então ela é criada arquivada por padrão.</p>
      ) : null}
      <LessonForm
        initial={null}
        submitLabel="Adicionar"
        isSaving={action.isPending}
        errorMessage={action.isError ? describeLessonError(action.error) : null}
        archivedOption={{ defaultChecked: published }}
        onSubmit={(fields, archived) =>
          action.mutate({ kind: 'add', moduleId: module.moduleId, fields, archived }, { onSuccess: () => setOpen(false) })
        }
        onCancel={() => {
          action.reset()
          setOpen(false)
        }}
      />
    </>
  )
}

export interface LessonActionsProps {
  readonly tree: CourseTree
  readonly module: ModuleNode
  readonly lesson: LessonNode
}

// Lesson-level: edit, move within/between modules, archive/unarchive, delete (with confirmation).
export function LessonActions({ tree, module, lesson }: LessonActionsProps) {
  const action = useLessonAction()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [targetModuleId, setTargetModuleId] = useState('')

  const moveUp = moveLesson(module, lesson.lessonId, 'up')
  const moveDown = moveLesson(module, lesson.lessonId, 'down')
  const targets = otherModulesOfCourse(tree.modules, module.moduleId)
  const archived = lesson.archivedAt !== null
  const pending = action.isPending
  const errorMessage = action.isError ? describeLessonError(action.error) : null
  const reorder = (lessonIds: readonly string[]) => action.mutate({ kind: 'reorder', moduleId: module.moduleId, lessonIds })

  if (editing) {
    return (
      <LessonForm
        // Remonta com os dados relidos após um conflito (stale_target).
        key={lesson.updatedAt}
        initial={{ title: lesson.title, durationSeconds: lesson.durationSeconds, isFreePreview: lesson.isFreePreview }}
        submitLabel="Salvar"
        isSaving={pending}
        errorMessage={errorMessage}
        onSubmit={(fields) =>
          action.mutate(
            { kind: 'update', lessonId: lesson.lessonId, expectedUpdatedAt: lesson.updatedAt, fields },
            { onSuccess: () => setEditing(false) },
          )
        }
        onCancel={() => {
          action.reset()
          setEditing(false)
        }}
      />
    )
  }

  return (
    <section aria-label="Ações da aula">
      {errorMessage && !confirmingDelete ? <Alert variant="error">{errorMessage}</Alert> : null}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>Editar</Button>
        <Button variant="secondary" disabled={pending || moveUp === null} onClick={() => moveUp && reorder(moveUp)}>Mover para cima</Button>
        <Button variant="secondary" disabled={pending || moveDown === null} onClick={() => moveDown && reorder(moveDown)}>Mover para baixo</Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => action.mutate({ kind: 'archive', lessonId: lesson.lessonId, expectedUpdatedAt: lesson.updatedAt, archived: !archived })}
        >
          {archived ? 'Desarquivar' : 'Arquivar'}
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            action.reset()
            setConfirmingDelete(true)
          }}
        >
          Excluir
        </Button>
      </div>
      {targets.length > 0 ? (
        <div className={styles.form}>
          <Select
            label="Mover para o módulo"
            placeholder="Selecione o módulo"
            value={targetModuleId}
            disabled={pending}
            options={targets.map((m) => ({ value: m.moduleId, label: m.title }))}
            onChange={(e) => setTargetModuleId(e.target.value)}
          />
          <div className={styles.actions}>
            <Button
              variant="secondary"
              aria-label="Mover para o módulo selecionado"
              disabled={pending || targetModuleId === ''}
              onClick={() =>
                action.mutate(
                  { kind: 'move', lessonId: lesson.lessonId, expectedUpdatedAt: lesson.updatedAt, targetModuleId },
                  { onSuccess: () => setTargetModuleId('') },
                )
              }
            >
              Mover
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog
        open={confirmingDelete}
        title="Excluir aula"
        dismissible={!pending}
        panelClassName="ph-no-capture"
        onClose={() => setConfirmingDelete(false)}
        description={<>Excluir a aula <strong>{lesson.title}</strong>? Esta ação não pode ser desfeita. Se o curso tiver vendas, arquive em vez de excluir.</>}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={pending} onClick={() => setConfirmingDelete(false)}>Cancelar</Button>
            <Button
              variant="danger"
              isLoading={pending}
              onClick={() =>
                action.mutate(
                  { kind: 'delete', lessonId: lesson.lessonId, expectedUpdatedAt: lesson.updatedAt },
                  { onSuccess: () => setConfirmingDelete(false) },
                )
              }
            >
              Excluir
            </Button>
          </>
        }
      >
        {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
      </Dialog>
    </section>
  )
}
