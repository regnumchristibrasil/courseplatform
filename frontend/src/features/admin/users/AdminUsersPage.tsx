import { useEffect, useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Pagination } from '../../../components/ui/Pagination'
import { Spinner } from '../../../components/ui/Spinner'
import type { AdminUserRow } from '../../../contracts/adminUsers'
import { useAuth } from '../../auth/useAuth'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { describeAdminUsersError } from './errors'
import { ChangeRoleDialog } from './components/ChangeRoleDialog'
import { ToggleActiveDialog } from './components/ToggleActiveDialog'
import { UsersFilters } from './components/UsersFilters'
import { UsersTable } from './components/UsersTable'
import { toErrorCode } from './toErrorCode'
import { useAdminUsers } from './useAdminUsers'
import styles from './AdminUsersPage.module.css'

type DialogState = { readonly kind: 'role' | 'active'; readonly user: AdminUserRow } | null

export function AdminUsersPage() {
  const { user: authUser } = useAuth()
  const access = useCurrentAccess()
  const { filters, setFilters, query } = useAdminUsers()
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = () => setDialog(null)
  const actorRole = access.data?.role ?? 'student'
  const data = query.data
  // Dados provisórios (página anterior) ou refetch com erro: tabela esmaecida e sem ações.
  const isStale = query.isPlaceholderData || query.isError
  const isOutOfRange = !query.isPlaceholderData && data !== undefined && data.users.length === 0 && filters.page > 1

  // Página além do fim (ex.: ?page=100): volta para a primeira sem empilhar histórico.
  useEffect(() => {
    if (isOutOfRange) setFilters({ page: 1 }, { replace: true })
  }, [isOutOfRange, setFilters])

  return (
    <section className={`${styles.page} ph-no-capture`}>
      <h1>Usuários</h1>
      <UsersFilters filters={filters} onChange={setFilters} />
      {query.isError ? (
        <Alert variant="error">
          <p>{describeAdminUsersError(toErrorCode(query.error)).message}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </Alert>
      ) : null}
      {!data && query.isPending ? <Spinner label="Carregando usuários..." /> : null}
      {data ? (
        <>
          <p className={styles.count}>{`${data.total} usuário(s)`}</p>
          <UsersTable
            users={data.users}
            actorId={authUser?.id ?? ''}
            actorRole={actorRole}
            isStale={isStale}
            onChangeRole={(user) => setDialog({ kind: 'role', user })}
            onToggleActive={(user) => setDialog({ kind: 'active', user })}
          />
          <Pagination
            page={filters.page}
            totalPages={Math.ceil(data.total / filters.limit)}
            onPageChange={(page) => setFilters({ page })}
          />
        </>
      ) : null}
      {dialog?.kind === 'role' ? (
        <ChangeRoleDialog user={dialog.user} actorId={authUser?.id ?? ''} actorRole={actorRole} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'active' ? <ToggleActiveDialog user={dialog.user} onClose={closeDialog} /> : null}
    </section>
  )
}

export default AdminUsersPage
