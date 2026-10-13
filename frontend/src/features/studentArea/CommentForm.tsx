import { useId, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { COMMENT_MAX_LENGTH } from '../../contracts/studentArea'
import { commentErrorMessage } from './commentErrors'
import styles from './LessonComments.module.css'
import { usePublishLessonComment } from './useLessonComments'

export interface CommentFormProps {
  readonly lessonId: string
  readonly parentId?: string
  readonly label?: string
  readonly submitLabel?: string
  readonly onPublished?: () => void
  readonly onCancel?: () => void
}

export function CommentForm({
  lessonId,
  parentId,
  label = 'Escreva um comentário',
  submitLabel = 'Publicar',
  onPublished,
  onCancel,
}: CommentFormProps) {
  const fieldId = useId()
  const [text, setText] = useState('')
  const publish = usePublishLessonComment(lessonId, parentId ?? null)
  const canSubmit = text.trim().length > 0 && !publish.isPending

  function onChange(value: string) {
    setText(value)
    if (publish.isError) publish.reset()
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    publish.mutate(text, {
      onSuccess: () => {
        setText('')
        onPublished?.()
      },
    })
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <textarea
        id={fieldId}
        className={styles.textarea}
        rows={3}
        value={text}
        maxLength={COMMENT_MAX_LENGTH}
        disabled={publish.isPending}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={styles.formFooter}>
        <span className={styles.counter}>{`${text.length}/${COMMENT_MAX_LENGTH}`}</span>
        <div className={styles.actions}>
          {onCancel ? (
            <Button variant="secondary" onClick={onCancel} disabled={publish.isPending}>
              Cancelar
            </Button>
          ) : null}
          <Button type="submit" disabled={!canSubmit} isLoading={publish.isPending}>
            {submitLabel}
          </Button>
        </div>
      </div>
      {publish.isError ? <Alert variant="error">{commentErrorMessage(publish.error, parentId !== undefined)}</Alert> : null}
    </form>
  )
}
