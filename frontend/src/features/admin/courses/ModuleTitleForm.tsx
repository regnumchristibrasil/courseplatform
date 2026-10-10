import { useState, type FormEvent } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { validateModuleTitle } from './moduleTitle'
import styles from './ModuleActions.module.css'

export interface ModuleTitleFormProps {
  readonly initialTitle: string
  readonly submitLabel: string
  readonly isSaving: boolean
  readonly errorMessage: string | null
  readonly onSubmit: (title: string) => void
  readonly onCancel: () => void
}

export function ModuleTitleForm({ initialTitle, submitLabel, isSaving, errorMessage, onSubmit, onCancel }: ModuleTitleFormProps) {
  const [title, setTitle] = useState(initialTitle)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateModuleTitle(title)
    setError(found)
    if (found === null) onSubmit(title.trim())
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
      <Input label="Título do módulo" value={title} error={error ?? undefined} onChange={(e) => setTitle(e.target.value)} />
      <div className={styles.actions}>
        <Button type="submit" isLoading={isSaving}>{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>Cancelar</Button>
      </div>
    </form>
  )
}
