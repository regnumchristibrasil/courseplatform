import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { isCourseCompleted, lessonRoute, type CourseTree, type CourseTreeModule } from '../../contracts/studentArea'
import { NotFoundPage } from '../../pages/NotFoundPage'
import styles from './CoursePage.module.css'
import { formatDuration } from './formatDuration'
import { LessonStateIcon } from './LessonStateIcon'
import { useCourseTree } from './useCourseTree'

const LOAD_ERROR_MESSAGE = 'Não foi possível carregar o curso. Tente novamente.'

function contentCountLabel(total: number): string {
  return total === 1 ? '1 conteúdo' : `${total} conteúdos`
}

function ModuleCard({ courseId, module, showState }: { courseId: string; module: CourseTreeModule; showState: boolean }) {
  const titleId = `module-${module.id}`
  return (
    <details className={styles.module} open aria-labelledby={titleId}>
      <summary id={titleId} className={styles.moduleSummary}>
        {module.title}
      </summary>
      <ul className={styles.lessons}>
        {module.lessons.map((lesson) => (
          <li key={lesson.id} className={styles.lesson}>
            {showState ? <LessonStateIcon state={lesson.state} /> : null}
            <Link to={lessonRoute(courseId, lesson.id)} className={styles.lessonTitle}>
              {lesson.title}
            </Link>
            <span className={styles.lessonDuration}>{formatDuration(lesson.durationSeconds)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function SideColumn({ tree }: { tree: CourseTree }) {
  const duration = formatDuration(tree.totalDurationSeconds)
  const continueLabel = isCourseCompleted(tree) ? 'Revisar curso' : 'Continuar de onde parei'
  return (
    <aside className={styles.side} aria-label="Sobre o curso">
      <h1 className={styles.title}>{tree.title}</h1>
      {tree.description ? <p className={styles.description}>{tree.description}</p> : null}
      <ul className={styles.facts}>
        {duration ? <li>{duration}</li> : null}
        <li>{contentCountLabel(tree.totalLessons)}</li>
      </ul>
      {tree.isStaff ? null : (
        <>
          <div className={styles.progress}>
            <div
              className={styles.track}
              role="progressbar"
              aria-label="Progresso do curso"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={tree.progressPercent}
            >
              <div className={styles.fill} style={{ width: `${tree.progressPercent}%` }} />
            </div>
            <span className={styles.percent}>{tree.progressPercent}%</span>
          </div>
          {tree.continueLessonId ? (
            <Link to={lessonRoute(tree.courseId, tree.continueLessonId)} className={styles.action}>
              {continueLabel}
            </Link>
          ) : null}
        </>
      )}
    </aside>
  )
}

export function CoursePage() {
  const { courseId = '' } = useParams<{ courseId: string }>()
  const { data: tree, isLoading, isError, refetch } = useCourseTree(courseId)

  if (isLoading) {
    return <Spinner label="Carregando o curso..." />
  }

  if (isError) {
    return (
      <Alert variant="error">
        <p>{LOAD_ERROR_MESSAGE}</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </Alert>
    )
  }

  // Sem direito, expirado, reembolsado ou inexistente: indistinguíveis (ADR 0004).
  if (!tree) {
    return <NotFoundPage />
  }

  return (
    <div className={styles.layout}>
      <SideColumn tree={tree} />
      <section className={styles.main} aria-label="Conteúdo do curso">
        {tree.modules.map((module) => (
          <ModuleCard key={module.id} courseId={tree.courseId} module={module} showState={!tree.isStaff} />
        ))}
      </section>
    </div>
  )
}

export default CoursePage
