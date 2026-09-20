import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
}

// Presentational only — used for "no data" / "nothing here yet" states.
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.emptyState} role="status">
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
