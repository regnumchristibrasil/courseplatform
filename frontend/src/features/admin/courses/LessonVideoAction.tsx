import { useState, type FormEvent } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type { LessonNode, SetLessonVideoResult } from '../../../contracts/adminCourses'
import { describeLessonError } from './lessonErrors'
import { describeVideoRef, validateVideoInput } from './lessonVideo'
import { useLessonVideo } from './useLessonVideo'
import styles from './ModuleActions.module.css'

export interface LessonVideoActionProps {
  readonly lesson: LessonNode
}

function SavedNotice({ saved }: { readonly saved: SetLessonVideoResult }) {
  if (saved.duplicates.length === 0) {
    return <Alert variant="success">Vídeo salvo: {describeVideoRef(saved)}.</Alert>
  }
  return (
    <Alert variant="warning">
      Vídeo salvo. Este vídeo também é usado em outras aulas:
      <ul>
        {saved.duplicates.map((d) => (
          <li key={`${d.courseTitle}/${d.lessonTitle}`}>{d.courseTitle} / {d.lessonTitle}</li>
        ))}
      </ul>
    </Alert>
  )
}

// Nível da aula: colar ID ou URL (YouTube ou Panda) para definir ou substituir o vídeo.
// O servidor normaliza e valida o formato; o vídeo anterior fica como histórico
// inativo. Reusar o vídeo em outra aula é permitido e apenas avisado.
export function LessonVideoAction({ lesson }: LessonVideoActionProps) {
  const action = useLessonVideo()
  const [open, setOpen] = useState(false)
  const [videoInput, setVideoInput] = useState('')
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState<SetLessonVideoResult | null>(null)

  const preview = validateVideoInput(videoInput)
  const errorMessage = action.isError ? describeLessonError(action.error) : null

  const close = () => {
    action.reset()
    setFormError(undefined)
    setVideoInput('')
    setOpen(false)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateVideoInput(videoInput)
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setFormError(undefined)
    action.mutate(
      { lessonId: lesson.lessonId, expectedUpdatedAt: lesson.updatedAt, videoInput },
      {
        onSuccess: (result) => {
          setSaved(result)
          close()
        },
      },
    )
  }

  return (
    <section aria-label="Vídeo da aula">
      {saved ? <SavedNotice saved={saved} /> : null}
      {open ? (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
          <Input
            label="ID ou URL do vídeo"
            value={videoInput}
            error={formError}
            onChange={(e) => setVideoInput(e.target.value)}
          />
          {preview.ok ? <p className={styles.hint}>Será salvo como {describeVideoRef(preview.parsed)}</p> : null}
          <div className={styles.actions}>
            <Button type="submit" isLoading={action.isPending}>Salvar vídeo</Button>
            <Button variant="secondary" onClick={close} disabled={action.isPending}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              setSaved(null)
              setOpen(true)
            }}
          >
            {lesson.video === null ? 'Definir vídeo' : 'Substituir vídeo'}
          </Button>
        </div>
      )}
    </section>
  )
}
