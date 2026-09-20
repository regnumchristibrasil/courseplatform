import styles from './Spinner.module.css'

export interface SpinnerProps {
  readonly label?: string
}

const DEFAULT_LABEL = 'Carregando...'

// Presentational only — a generic loading indicator.
export function Spinner({ label = DEFAULT_LABEL }: SpinnerProps) {
  return (
    <div className={styles.spinner} role="status" aria-label={label}>
      <span className={styles.circle} aria-hidden="true" />
    </div>
  )
}
