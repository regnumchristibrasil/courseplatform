import type { AdminUserRow } from '../../../../contracts/adminUsers'
import { statusLabel } from '../roleLabels'
import { useConfirmAction } from '../useConfirmAction'
import { useSetUserActive } from '../useSetUserActive'
import { ConfirmDialog } from './ConfirmDialog'

export interface ToggleActiveDialogProps {
  readonly user: AdminUserRow
  readonly onClose: () => void
}

export function ToggleActiveDialog({ user, onClose }: ToggleActiveDialogProps) {
  const mutation = useSetUserActive()
  const nextActive = !user.isActive
  const action = useConfirmAction({
    mutation,
    onClose,
    // Após auth_sync_failed o flag no banco já foi gravado: a nova tentativa
    // precisa enviar expectedActive = estado pedido para o RPC ver um no-op
    // e a Edge Function só refazer a sincronização com o Auth.
    buildVars: (reason, isRetry) => ({
      userId: user.userId,
      active: nextActive,
      expectedActive: isRetry ? nextActive : user.isActive,
      ...(reason ? { reason } : {}),
    }),
  })

  return (
    <ConfirmDialog
      title={nextActive ? 'Reativar usuário' : 'Desativar usuário'}
      email={user.email}
      summary={`${statusLabel(user.isActive)} → ${statusLabel(nextActive)}`}
      reason={action.reason}
      onReasonChange={action.setReason}
      error={action.error}
      isPending={action.isPending}
      onConfirm={action.confirm}
      onRetry={action.retry}
      onReload={action.reload}
      onClose={onClose}
    />
  )
}
