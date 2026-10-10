import { useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import type { CourseTree, ModuleNode } from '../../../contracts/adminCourses'
import { moveModule } from './courseTreeModel'
import { describeModuleError } from './moduleErrors'
import { ModuleTitleForm } from './ModuleTitleForm'
import { useModuleAction } from './useModuleAction'
import styles from './ModuleActions.module.css'

// Course-level: append a module.
export function AddModuleAction({ courseId }: { readonly courseId: string }) {
  const action = useModuleAction()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setOpen(true)}>Adicionar módulo</Button>
      </div>
    )
  }
  return (
    <ModuleTitleForm
      initialTitle=""
      submitLabel="Adicionar"
      isSaving={action.isPending}
      errorMessage={action.isError ? describeModuleError(action.error) : null}
      onSubmit={(title) => action.mutate({ kind: 'add', courseId, title }, { onSuccess: () => setOpen(false) })}
      onCancel={() => {
        action.reset()
        setOpen(false)
      }}
    />
  )
}

export interface ModuleActionsProps {
  readonly tree: CourseTree
  readonly module: ModuleNode
}

// Module-level: rename, move, archive/unarchive, delete (with confirmation).
export function ModuleActions({ tree, module }: ModuleActionsProps) {
  const action = useModuleAction()
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const moveUp = moveModule(tree.modules, module.moduleId, 'up')
  const moveDown = moveModule(tree.modules, module.moduleId, 'down')
  const archived = module.archivedAt !== null
  const pending = action.isPending
  const errorMessage = action.isError ? describeModuleError(action.error) : null
  const reorder = (moduleIds: readonly string[]) => action.mutate({ kind: 'reorder', courseId: tree.courseId, moduleIds })

  if (renaming) {
    return (
      <ModuleTitleForm
        initialTitle={module.title}
        submitLabel="Salvar"
        isSaving={pending}
        errorMessage={errorMessage}
        onSubmit={(title) => action.mutate({ kind: 'rename', moduleId: module.moduleId, title }, { onSuccess: () => setRenaming(false) })}
        onCancel={() => {
          action.reset()
          setRenaming(false)
        }}
      />
    )
  }

  return (
    <section aria-label="Ações do módulo">
      {errorMessage && !confirmingDelete ? <Alert variant="error">{errorMessage}</Alert> : null}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={pending} onClick={() => setRenaming(true)}>Renomear</Button>
        <Button variant="secondary" disabled={pending || moveUp === null} onClick={() => moveUp && reorder(moveUp)}>Mover para cima</Button>
        <Button variant="secondary" disabled={pending || moveDown === null} onClick={() => moveDown && reorder(moveDown)}>Mover para baixo</Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => action.mutate({ kind: 'archive', moduleId: module.moduleId, archived: !archived })}
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
      <Dialog
        open={confirmingDelete}
        title="Excluir módulo"
        dismissible={!pending}
        panelClassName="ph-no-capture"
        onClose={() => setConfirmingDelete(false)}
        description={<>Excluir o módulo <strong>{module.title}</strong>? Esta ação não pode ser desfeita. Se houver aulas ou vendas no curso, arquive em vez de excluir.</>}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={pending} onClick={() => setConfirmingDelete(false)}>Cancelar</Button>
            <Button
              variant="danger"
              isLoading={pending}
              onClick={() => action.mutate({ kind: 'delete', moduleId: module.moduleId }, { onSuccess: () => setConfirmingDelete(false) })}
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
