import { Badge } from '../../../../components/ui/Badge'
import { Button } from '../../../../components/ui/Button'
import { Table, type TableColumn } from '../../../../components/ui/Table'
import type { AdminUserRow, Role } from '../../../../contracts/adminUsers'
import { canChangeRole, canToggleActive, type PermissionContext } from '../../../authz/permissions'
import { ROLE_LABELS, statusLabel } from '../roleLabels'

export interface UsersTableProps {
  readonly users: readonly AdminUserRow[]
  readonly actorId: string
  readonly actorRole: Role
  // Dados provisórios (keepPreviousData): tabela ocupada e ações desabilitadas.
  readonly isStale?: boolean
  readonly onChangeRole: (user: AdminUserRow) => void
  readonly onToggleActive: (user: AdminUserRow) => void
}

// UX apenas: esconde ações que o servidor rejeitaria. O servidor valida tudo.
function contextFor(props: UsersTableProps, user: AdminUserRow): PermissionContext {
  return { actorId: props.actorId, actorRole: props.actorRole, targetId: user.userId, targetRole: user.role }
}

function Actions({ props, user }: { readonly props: UsersTableProps; readonly user: AdminUserRow }) {
  const context = contextFor(props, user)
  const disabled = props.isStale === true
  return (
    <>
      {canChangeRole(context) ? (
        <Button variant="secondary" disabled={disabled} aria-label={`Alterar papel de ${user.email}`} onClick={() => props.onChangeRole(user)}>
          Alterar papel
        </Button>
      ) : null}
      {canToggleActive(context) ? (
        <Button
          variant={user.isActive ? 'danger' : 'secondary'}
          disabled={disabled}
          aria-label={`${user.isActive ? 'Desativar' : 'Reativar'} ${user.email}`}
          onClick={() => props.onToggleActive(user)}
        >
          {user.isActive ? 'Desativar' : 'Reativar'}
        </Button>
      ) : null}
    </>
  )
}

function buildColumns(props: UsersTableProps): readonly TableColumn<AdminUserRow>[] {
  return [
    { key: 'fullName', header: 'Nome', render: (u) => (u.fullName ? <bdi>{u.fullName}</bdi> : '—') },
    { key: 'email', header: 'E-mail', render: (u) => <bdi>{u.email}</bdi> },
    { key: 'role', header: 'Papel', render: (u) => <Badge variant="info">{ROLE_LABELS[u.role]}</Badge> },
    {
      key: 'isActive',
      header: 'Status',
      render: (u) => <Badge variant={u.isActive ? 'success' : 'danger'}>{statusLabel(u.isActive)}</Badge>,
    },
    { key: 'actions', header: 'Ações', render: (u) => <Actions props={props} user={u} /> },
  ]
}

export function UsersTable(props: UsersTableProps) {
  return (
    <Table
      caption="Usuários"
      className="ph-no-capture"
      busy={props.isStale === true}
      columns={buildColumns(props)}
      rows={props.users}
      getRowKey={(u) => u.userId}
      emptyMessage="Nenhum usuário encontrado."
    />
  )
}
