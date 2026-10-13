import { Link } from 'react-router-dom'
import { canRepurchase, myCourseRoute, STUDENT_AREA_ROUTES, type MyCourse } from '../../contracts/studentArea'
import styles from './MyCoursesPage.module.css'

export interface MyCourseCardProps {
  readonly course: MyCourse
}

// Presentational: o progresso é calculado no servidor (ADR 0004).
export function MyCourseCard({ course }: MyCourseCardProps) {
  const action = course.isExpired ? (
    canRepurchase(course) ? (
      <Link to={STUDENT_AREA_ROUTES.catalog} className={styles.actionSecondary}>
        Comprar novamente
      </Link>
    ) : null
  ) : (
    <Link to={myCourseRoute(course.courseId)} className={styles.action}>
      Continuar
    </Link>
  )
  const headingId = `my-course-${course.courseId}`
  return (
    <article className={styles.card} aria-labelledby={headingId} data-expired={course.isExpired}>
      <div className={styles.cover} aria-hidden="true" />
      <div className={styles.body}>
        <h2 id={headingId} className={styles.title}>
          {course.title}
        </h2>
        {course.isExpired ? <span className={styles.expiredLabel}>Acesso expirado</span> : null}
        <div className={styles.progress}>
          <div
            className={styles.track}
            role="progressbar"
            aria-label="Progresso do curso"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={course.progressPercent}
          >
            <div className={styles.fill} style={{ width: `${course.progressPercent}%` }} />
          </div>
          <span className={styles.percent}>{course.progressPercent}%</span>
        </div>
        {action}
      </div>
    </article>
  )
}
