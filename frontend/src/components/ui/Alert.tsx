import type { ReactNode } from 'react'
import styles from './Alert.module.css'

export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

export interface AlertProps {
  readonly variant?: AlertVariant
  readonly children: ReactNode
}

// Variants that demand immediate attention use the assertive `alert` role;
// informational ones use the polite `status` role, so screen readers don't
// interrupt the user for routine messages.
const ASSERTIVE_VARIANTS: readonly AlertVariant[] = ['error', 'warning']

// Presentational only — callers decide when/why to show an alert.
export function Alert({ variant = 'info', children }: AlertProps) {
  const role = ASSERTIVE_VARIANTS.includes(variant) ? 'alert' : 'status'

  return (
    <div className={[styles.alert, styles[variant]].join(' ')} role={role}>
      {children}
    </div>
  )
}
