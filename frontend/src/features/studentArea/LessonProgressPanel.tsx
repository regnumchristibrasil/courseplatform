import { Alert } from '../../components/ui/Alert'
import type { CourseTree, LessonState } from '../../contracts/studentArea'
import styles from './LessonPage.module.css'
import { useSetLessonCompleted } from './useSetLessonCompleted'

const UPDATE_ERROR_MESSAGE = 'Não foi possível atualizar a conclusão da aula. Tente novamente.'

export interface LessonProgressPanelProps {
  readonly tree: Pick<CourseTree, 'totalLessons' | 'completedLessons' | 'progressPercent'>
  readonly lessonId: string
  readonly lessonState: LessonState
}

function lessonsCompletedLabel(completed: number, total: number): string {
  return `${completed} de ${total} ${total === 1 ? 'aula concluída' : 'aulas concluídas'}`
}

// Rótulo fixo + aria-pressed: o estado é anunciado pelo atributo, e o ícone
// muda de forma (check x círculo vazio), nunca só de cor.
export function LessonProgressPanel({ tree, lessonId, lessonState }: LessonProgressPanelProps) {
  const { mutate, isPending, isError, data } = useSetLessonCompleted()
  // data === false: servidor respondeu sem efeito (sem direito, aula arquivada).
  const hasError = isError || data === false
  const isCompleted = lessonState === 'completed'

  function toggle() {
    mutate({ lessonId, completed: !isCompleted })
  }

  return (
    <section className={styles.panel} aria-label="Progresso">
      <button type="button" className={styles.completeButton} aria-pressed={isCompleted} disabled={isPending} onClick={toggle}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          {isCompleted ? <path d="M7 12.5l3.5 3.5L17 9" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </svg>
        Marcar como concluído
      </button>
      {hasError ? <Alert variant="error">{UPDATE_ERROR_MESSAGE}</Alert> : null}
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
      <p className={styles.progressCount}>{lessonsCompletedLabel(tree.completedLessons, tree.totalLessons)}</p>
    </section>
  )
}
