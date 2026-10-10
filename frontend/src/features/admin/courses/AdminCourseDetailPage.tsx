import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { AdminCoursesApiError, SESSION_EXPIRED_MESSAGE } from './api'
import { CourseDetailPanel } from './CourseDetailPanel'
import { CourseTreeView } from './CourseTreeView'
import { COURSE_SELECTION, resolveSelection, type TreeSelection } from './courseTreeModel'
import { useAdminCourse } from './useAdminCourse'
import styles from './AdminCourseDetailPage.module.css'

function errorCode(error: unknown) {
  return error instanceof AdminCoursesApiError ? error.code : 'internal'
}

function describeError(error: unknown): string {
  switch (errorCode(error)) {
    case 'not_found':
      return 'Curso não encontrado.'
    case 'forbidden':
      return 'Você não tem permissão para acessar este curso.'
    case 'unauthorized':
      return SESSION_EXPIRED_MESSAGE
    default:
      return 'Não foi possível carregar o curso. Tente novamente.'
  }
}

const RETRYABLE_CODES: readonly string[] = ['internal']

export function AdminCourseDetailPage() {
  const { courseId = '' } = useParams()
  const query = useAdminCourse(courseId)
  const [selection, setSelection] = useState<TreeSelection>(COURSE_SELECTION)
  const tree = query.data

  return (
    <section className={`${styles.page} ph-no-capture`}>
      <Link to="/admin/courses">Voltar para cursos</Link>
      {query.isError ? (
        <Alert variant="error">
          <p>{describeError(query.error)}</p>
          {RETRYABLE_CODES.includes(errorCode(query.error)) ? (
            <Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>
          ) : null}
        </Alert>
      ) : null}
      {!tree && query.isPending ? <Spinner label="Carregando curso..." /> : null}
      {tree ? (
        <div className={styles.workspace}>
          <CourseTreeView tree={tree} selection={selection} onSelect={setSelection} />
          <CourseDetailPanel tree={tree} selection={resolveSelection(tree, selection)} />
        </div>
      ) : null}
    </section>
  )
}

export default AdminCourseDetailPage
