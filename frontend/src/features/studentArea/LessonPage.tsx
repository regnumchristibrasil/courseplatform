import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { lessonRoute, myCourseRoute } from '../../contracts/studentArea'
import { NotFoundPage } from '../../pages/NotFoundPage'
import { formatDuration } from './formatDuration'
import { findLessonContext } from './lessonContext'
import { LessonComments } from './LessonComments'
import { LessonProgressPanel } from './LessonProgressPanel'
import { LessonStateIcon } from './LessonStateIcon'
import { LessonVideo } from './LessonVideo'
import styles from './LessonPage.module.css'
import { useCourseTree } from './useCourseTree'
import { useStartLesson } from './useStartLesson'

export function LessonPage() {
  const { courseId = '', lessonId = '' } = useParams<{ courseId: string; lessonId: string }>()
  const { data: tree, isLoading, isError, refetch } = useCourseTree(courseId)
  const { mutate: start } = useStartLesson()
  const startedRef = useRef<string | null>(null)

  const context = tree ? findLessonContext(tree, lessonId) : null
  const shouldStart = context !== null && tree !== null && tree !== undefined && !tree.isStaff && context.lesson.state === 'not_started'

  // Uma chamada por aula aberta; o servidor também é idempotente.
  useEffect(() => {
    if (shouldStart && startedRef.current !== lessonId) {
      startedRef.current = lessonId
      start(lessonId)
    }
  }, [shouldStart, lessonId, start])

  if (isLoading) {
    return <Spinner label="Carregando a aula..." />
  }

  if (isError) {
    return (
      <Alert variant="error">
        <p>Não foi possível carregar a aula. Tente novamente.</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </Alert>
    )
  }

  // Sem direito, só pré-visualização, aula arquivada ou inexistente (ADR 0004).
  if (!tree || !context) {
    return <NotFoundPage />
  }

  const { lesson, module, previous, next } = context
  const duration = formatDuration(lesson.durationSeconds)

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <nav aria-label="Trilha de navegação" className={styles.breadcrumb}>
          <Link to={myCourseRoute(tree.courseId)}>{tree.title}</Link>
          <span aria-hidden="true">/</span>
          <span>{module.title}</span>
        </nav>
        <LessonVideo key={lesson.id} lessonId={lesson.id} />
        <h1 className={styles.title}>{lesson.title}</h1>
        {duration ? <p className={styles.duration}>{duration}</p> : null}
        <div className={styles.pager}>
          {previous ? (
            <Link to={lessonRoute(tree.courseId, previous.id)} className={styles.pagerLink}>
              Aula anterior
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={lessonRoute(tree.courseId, next.id)} className={styles.pagerLink}>
              Próxima aula
            </Link>
          ) : null}
        </div>
        {tree.isStaff ? null : <LessonProgressPanel tree={tree} lessonId={lesson.id} lessonState={lesson.state} />}
        <LessonComments key={lesson.id} lessonId={lesson.id} />
      </div>
      <nav aria-label="Aulas do módulo" className={styles.side}>
        <h2 className={styles.sideTitle}>{module.title}</h2>
        <ul className={styles.lessons}>
          {module.lessons.map((item) => (
            <li key={item.id}>
              <Link
                to={lessonRoute(tree.courseId, item.id)}
                className={styles.lessonLink}
                aria-current={item.id === lesson.id ? 'page' : undefined}
              >
                {tree.isStaff ? null : <LessonStateIcon state={item.state} />}
                <span className={styles.lessonTitle}>{item.title}</span>
                <span className={styles.lessonDuration}>{formatDuration(item.durationSeconds)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

export default LessonPage
