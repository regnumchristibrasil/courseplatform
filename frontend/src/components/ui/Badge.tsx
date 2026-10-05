import type { ReactNode } from 'react'
import styles from './Badge.module.css'

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps {
  readonly variant?: BadgeVariant
  readonly children: ReactNode
}

// Presentational only — a small status label.
export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return <span className={[styles.badge, styles[variant]].join(' ')}>{children}</span>
}
