import { useId } from 'react'
import { MAX_REASON_LENGTH } from '../../../../contracts/adminUsers'
import styles from './ReasonField.module.css'

export interface ReasonFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

// Apenas apresentação: motivo opcional em texto livre com contador de caracteres.
export function ReasonField({ value, onChange, disabled = false }: ReasonFieldProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        Motivo (opcional)
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        rows={3}
        maxLength={MAX_REASON_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter insere quebra de linha; Ctrl/Cmd+Enter confirma o formulário.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <span className={styles.counter}>{`${value.length}/${MAX_REASON_LENGTH}`}</span>
    </div>
  )
}
