import type { LessonState } from '../../contracts/studentArea'
import styles from './CoursePage.module.css'

const STATE_LABELS: Record<LessonState, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em andamento',
  completed: 'Concluída',
}

export interface LessonStateIconProps {
  readonly state: LessonState
}

// O estado nunca depende só da cor: cada um tem forma própria (play, play com
// anel, check) e um rótulo para leitores de tela.
export function LessonStateIcon({ state }: LessonStateIconProps) {
  return (
    <span className={styles.stateIcon} data-state={state}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {state === 'completed' ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            {state === 'in_progress' ? <circle cx="12" cy="12" r="10" /> : null}
            <path d="M9.5 8l6 4-6 4z" fill="currentColor" strokeLinejoin="round" />
          </>
        )}
      </svg>
      <span className={styles.srOnly}>{STATE_LABELS[state]}</span>
    </span>
  )
}
