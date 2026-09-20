import type { ReactNode } from 'react'
import styles from './Card.module.css'

export interface CardProps {
  readonly title?: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}

// Presentational only — a generic content container, no data fetching.
export function Card({ title, children, footer }: CardProps) {
  return (
    <div className={styles.card}>
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  )
}
