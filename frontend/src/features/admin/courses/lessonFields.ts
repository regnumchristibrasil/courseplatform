import {
  MAX_LESSON_DURATION_SECONDS,
  MAX_LESSON_TITLE_LENGTH,
  MIN_LESSON_DURATION_SECONDS,
  type LessonFieldsInput,
} from '../../../contracts/adminCourses'

export interface LessonFormValues {
  readonly title: string
  readonly duration: string
  readonly isFreePreview: boolean
}

export interface LessonFormErrors {
  readonly title?: string
  readonly duration?: string
}

export type DurationParse = { readonly ok: true; readonly value: number | null } | { readonly ok: false }

export type LessonValidation =
  | { readonly ok: true; readonly fields: LessonFieldsInput }
  | { readonly ok: false; readonly errors: LessonFormErrors }

const DURATION_PATTERN = /^\d+$/

// Blank = unknown duration (null). Otherwise whole seconds within the server range.
export function parseDurationSeconds(raw: string): DurationParse {
  const text = raw.trim()
  if (text === '') return { ok: true, value: null }
  if (!DURATION_PATTERN.test(text)) return { ok: false }
  const value = Number(text)
  return value >= MIN_LESSON_DURATION_SECONDS && value <= MAX_LESSON_DURATION_SECONDS ? { ok: true, value } : { ok: false }
}

function validateTitle(title: string): string | undefined {
  if (title === '') return 'Informe o título da aula.'
  if ([...title].length > MAX_LESSON_TITLE_LENGTH) return `O título deve ter no máximo ${MAX_LESSON_TITLE_LENGTH} caracteres.`
  return undefined
}

// Same rules as app_private.assert_valid_lesson_fields (title trimmed, 1..200 characters).
export function validateLessonFields(values: LessonFormValues): LessonValidation {
  const title = values.title.trim()
  const duration = parseDurationSeconds(values.duration)
  const titleError = validateTitle(title)
  const durationError = duration.ok
    ? undefined
    : `A duração deve ser um número inteiro de segundos entre ${MIN_LESSON_DURATION_SECONDS} e ${MAX_LESSON_DURATION_SECONDS}.`
  if (titleError !== undefined || !duration.ok) {
    return { ok: false, errors: { title: titleError, duration: durationError } }
  }
  return { ok: true, fields: { title, durationSeconds: duration.value, isFreePreview: values.isFreePreview } }
}
