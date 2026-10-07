import { useId, type SelectHTMLAttributes } from 'react'
import styles from './Select.module.css'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  readonly label: string
  readonly options: readonly SelectOption[]
  readonly id?: string
  readonly error?: string
  readonly placeholder?: string
}

// Presentational only — native select wrapper; value ownership stays with the caller.
export function Select({ label, options, id, error, placeholder, className, ...rest }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const errorId = `${selectId}-error`

  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={[styles.select, error ? styles.selectError : '', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
