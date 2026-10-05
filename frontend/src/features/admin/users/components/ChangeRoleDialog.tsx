import { useState } from 'react'
import type { AdminUserRow, Role } from '../../../../contracts/adminUsers'
import { Select } from '../../../../components/ui/Select'
import { assignableRoles } from '../../../authz/permissions'
import { ROLE_LABELS } from '../roleLabels'
import { useConfirmAction } from '../useConfirmAction'
import { useSetUserRole } from '../useSetUserRole'
import { ConfirmDialog } from './ConfirmDialog'

export interface ChangeRoleDialogProps {
  readonly user: AdminUserRow
  readonly actorId: string
  readonly actorRole: Role
  readonly onClose: () => void
}

const PRIVILEGED_ROLES: readonly Role[] = ['admin', 'superadmin']
const PRIVILEGE_WARNING = 'Atenção: este papel concede acesso administrativo à plataforma.'

export function ChangeRoleDialog({ user, actorId, actorRole, onClose }: ChangeRoleDialogProps) {
  const mutation = useSetUserRole()
  const options = assignableRoles({ actorId, actorRole, targetId: user.userId, targetRole: user.role })
  const [newRole, setNewRole] = useState<Role>(options[0] ?? user.role)
  const action = useConfirmAction({
    mutation,
    onClose,
    buildVars: (reason) => ({
      userId: user.userId,
      role: newRole,
      expectedRole: user.role,
      ...(reason ? { reason } : {}),
    }),
  })

  return (
    <ConfirmDialog
      title="Alterar papel"
      email={user.email}
      summary={`${ROLE_LABELS[user.role]} → ${ROLE_LABELS[newRole]}`}
      warning={PRIVILEGED_ROLES.includes(newRole) ? PRIVILEGE_WARNING : undefined}
      reason={action.reason}
      onReasonChange={action.setReason}
      error={action.error}
      isPending={action.isPending}
      confirmDisabled={options.length === 0 || newRole === user.role}
      onConfirm={action.confirm}
      onRetry={action.retry}
      onReload={action.reload}
      onClose={onClose}
    >
      <Select
        label="Novo papel"
        value={newRole}
        disabled={mutation.isPending}
        options={options.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
        onChange={(event) => setNewRole(event.target.value as Role)}
      />
    </ConfirmDialog>
  )
}
