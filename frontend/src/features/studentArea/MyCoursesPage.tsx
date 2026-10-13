import { Link } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Spinner } from '../../components/ui/Spinner'
import { MyCourseCard } from './MyCourseCard'
import styles from './MyCoursesPage.module.css'
import { useMyCourses } from './useMyCourses'

const LOAD_ERROR_MESSAGE = 'Não foi possível carregar seus cursos. Tente novamente.'

export function MyCoursesPage() {
  const { data: courses, isLoading, isError, refetch } = useMyCourses()

  if (isLoading) {
    return <Spinner label="Carregando seus cursos..." />
  }

  if (isError) {
    return (
      <Alert variant="error">
        <p>{LOAD_ERROR_MESSAGE}</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </Alert>
    )
  }

  return (
    <section aria-labelledby="my-courses-title">
      <h1 id="my-courses-title">Meus cursos</h1>
      {!courses || courses.length === 0 ? (
        <EmptyState
          title="Você ainda não tem cursos"
          description="Conheça os cursos disponíveis no catálogo."
          action={<Link to="/">Ver catálogo</Link>}
        />
      ) : (
        <ul className={styles.grid}>
          {courses.map((course) => (
            <li key={course.courseId}>
              <MyCourseCard course={course} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default MyCoursesPage
