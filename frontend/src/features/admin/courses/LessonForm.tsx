import { useState, type FormEvent } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type { LessonFieldsInput } from '../../../contracts/adminCourses'
import { validateLessonFields, type LessonFormErrors } from './lessonFields'
import styles from './ModuleActions.module.css'

export interface LessonFormProps {
  readonly initial: LessonFieldsInput | null // null = new lesson
  readonly submitLabel: string
  readonly isSaving: boolean
  readonly errorMessage: string | null
  // Present only when creating: whether to offer "create archived", and its default.
  readonly archivedOption?: { readonly defaultChecked: boolean }
  readonly onSubmit: (fields: LessonFieldsInput, archived: boolean) => void
  readonly onCancel: () => void
}

export function LessonForm({ initial, submitLabel, isSaving, errorMessage, archivedOption, onSubmit, onCancel }: LessonFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [duration, setDuration] = useState(initial?.durationSeconds?.toString() ?? '')
  const [isFreePreview, setIsFreePreview] = useState(initial?.isFreePreview ?? false)
  const [archived, setArchived] = useState(archivedOption?.defaultChecked ?? false)
  const [errors, setErrors] = useState<LessonFormErrors>({})

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateLessonFields({ title, duration, isFreePreview })
    if (result.ok) {
      setErrors({})
      onSubmit(result.fields, archivedOption ? archived : false)
    } else {
      setErrors(result.errors)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
      <Input label="Título da aula" value={title} error={errors.title} onChange={(e) => setTitle(e.target.value)} />
      <Input
        label="Duração (segundos)"
        inputMode="numeric"
        value={duration}
        error={errors.duration}
        onChange={(e) => setDuration(e.target.value)}
      />
      <label className={styles.check}>
        <input type="checkbox" checked={isFreePreview} onChange={(e) => setIsFreePreview(e.target.checked)} />
        Prévia gratuita
      </label>
      {archivedOption ? (
        <label className={styles.check}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Criar arquivada
        </label>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" isLoading={isSaving}>{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>Cancelar</Button>
      </div>
    </form>
  )
}
