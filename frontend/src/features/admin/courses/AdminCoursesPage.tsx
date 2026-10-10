import { Link } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Spinner } from '../../../components/ui/Spinner'
import { Table, type TableColumn } from '../../../components/ui/Table'
import type { CourseListRow } from '../../../contracts/adminCourses'
import { AdminCoursesApiError } from './api'
import { CourseStatusBadge } from './CourseStatusBadge'
import { formatAccessDuration, formatPrice } from './format'
import { useAdminCourses } from './useAdminCourses'
import styles from './AdminCoursesPage.module.css'

const COLUMNS: readonly TableColumn<CourseListRow>[] = [
  {
    key: 'title',
    header: 'Curso',
    render: (row) => <Link to={`/admin/courses/${row.courseId}`}>{row.title}</Link>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <CourseStatusBadge status={row.status} />,
  },
  { key: 'priceCents', header: 'Preço', render: (row) => formatPrice(row.priceCents) },
  { key: 'accessDurationDays', header: 'Acesso', render: (row) => formatAccessDuration(row.accessDurationDays) },
  { key: 'enrollmentCount', header: 'Matrículas' },
  { key: 'pendingOrderCount', header: 'Pedidos pendentes' },
]

function describeError(error: unknown): string {
  const code = error instanceof AdminCoursesApiError ? error.code : 'internal'
  if (code === 'forbidden') return 'Você não tem permissão para acessar os cursos.'
  if (code === 'unauthorized') return 'Sua sessão expirou. Entre novamente.'
  return 'Não foi possível carregar os cursos. Tente novamente.'
}

export function AdminCoursesPage() {
  const query = useAdminCourses()
  const courses = query.data

  return (
    <section className={`${styles.page} ph-no-capture`}>
      <h1>Cursos</h1>
      {query.isError ? (
        <Alert variant="error">
          <p>{describeError(query.error)}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </Alert>
      ) : null}
      {!courses && query.isPending ? <Spinner label="Carregando cursos..." /> : null}
      {courses && courses.length === 0 ? <EmptyState title="Nenhum curso cadastrado." /> : null}
      {courses && courses.length > 0 ? (
        <>
          <p className={styles.count}>{`${courses.length} curso(s)`}</p>
          <Table
            caption="Cursos"
            columns={COLUMNS}
            rows={courses}
            getRowKey={(row) => row.courseId}
            busy={query.isError}
          />
        </>
      ) : null}
    </section>
  )
}

export default AdminCoursesPage
