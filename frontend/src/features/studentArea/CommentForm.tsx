import { useId, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { COMMENT_MAX_LENGTH } from '../../contracts/studentArea'
import { commentErrorMessage } from './commentErrors'
import styles from './LessonComments.module.css'
import { usePublishLessonComment } from './useLessonComments'

export function CommentForm({ lessonId }: { readonly lessonId: string }) {
  const fieldId = useId()
  const [text, setText] = useState('')
  const publish = usePublishLessonComment(lessonId)
  const canSubmit = text.trim().length > 0 && !publish.isPending

  function onChange(value: string) {
    setText(value)
    if (publish.isError) publish.reset()
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    publish.mutate(text, { onSuccess: () => setText('') })
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label htmlFor={fieldId} className={styles.label}>
        Escreva um comentário
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
        <Button type="submit" disabled={!canSubmit} isLoading={publish.isPending}>
          Publicar
        </Button>
      </div>
      {publish.isError ? <Alert variant="error">{commentErrorMessage(publish.error)}</Alert> : null}
    </form>
  )
}
