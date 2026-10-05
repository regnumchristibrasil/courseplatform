import { useId, type FormEvent, type ReactNode } from 'react'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { Dialog } from '../../../../components/ui/Dialog'
import { describeAdminUsersError } from '../errors'
import { toErrorCode } from '../toErrorCode'
import { ReasonField } from './ReasonField'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  readonly title: string
  readonly email: string
  readonly summary: string
  readonly warning?: string
  readonly reason: string
  readonly onReasonChange: (value: string) => void
  readonly error: Error | null
  readonly isPending: boolean
  readonly confirmDisabled?: boolean
  readonly onConfirm: () => void
  readonly onRetry: () => void
  readonly onReload: () => void
  readonly onClose: () => void
  readonly children?: ReactNode
}

// Casca compartilhada dos diálogos de papel/status. Estado e mutação ficam
// com o diálogo específico que a compõe.
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { title, email, summary, warning, reason, onReasonChange, error, isPending, confirmDisabled = false, onConfirm, onRetry, onReload, onClose, children } = props
  const view = error ? describeAdminUsersError(toErrorCode(error)) : null
  const formId = useId()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isPending && !confirmDisabled) onConfirm()
  }

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      dismissible={!isPending}
      panelClassName="ph-no-capture"
      description={
        <>
          <p className={styles.email}>
            <bdi>{email}</bdi>
          </p>
          <p className={styles.summary}>{summary}</p>
        </>
      }
      footer={
        <>
          <Button variant="secondary" data-autofocus disabled={isPending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} isLoading={isPending} disabled={confirmDisabled}>
            Confirmar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit}>
        {children}
        {warning ? <Alert variant="warning">{warning}</Alert> : null}
        <ReasonField value={reason} onChange={onReasonChange} disabled={isPending} />
        {view ? (
          <Alert variant="error">
            <p>{view.message}</p>
            {view.action === 'reload' ? <Button variant="secondary" onClick={onReload}>Recarregar lista</Button> : null}
            {view.action === 'retry' ? <Button variant="secondary" onClick={onRetry}>Tentar novamente</Button> : null}
          </Alert>
        ) : null}
      </form>
    </Dialog>
  )
}
