import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly isLoading?: boolean
  readonly children: ReactNode
}

// Presentational only — no business logic, no data fetching. Pages compose
// this with their own handlers.
export function Button({
  variant = 'primary',
  isLoading = false,
  disabled = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classNames = [styles.button, styles[variant], className].filter(Boolean).join(' ')

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled || isLoading}
      aria-busy={isLoading ? true : undefined}
      {...rest}
    >
      {isLoading ? <span className={styles.spinnerDot} aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
