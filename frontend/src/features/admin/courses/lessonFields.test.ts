import { describe, expect, it } from 'vitest'
import { parseDurationSeconds, validateLessonFields } from './lessonFields'

describe('parseDurationSeconds', () => {
  it('blank means unknown', () => {
    expect(parseDurationSeconds('')).toEqual({ ok: true, value: null })
    expect(parseDurationSeconds('   ')).toEqual({ ok: true, value: null })
  })

  it('accepts whole seconds within the range', () => {
    expect(parseDurationSeconds(' 90 ')).toEqual({ ok: true, value: 90 })
    expect(parseDurationSeconds('86400')).toEqual({ ok: true, value: 86400 })
  })

  it.each(['0', '-5', '1.5', 'abc', '86401', '1e3'])('rejects %s', (raw) => {
    expect(parseDurationSeconds(raw).ok).toBe(false)
  })
})

describe('validateLessonFields', () => {
  it('returns trimmed fields when valid', () => {
    expect(validateLessonFields({ title: '  Aula  ', duration: '90', isFreePreview: true })).toEqual({
      ok: true,
      fields: { title: 'Aula', durationSeconds: 90, isFreePreview: true },
    })
  })

  it('reports a blank title and a too-long title', () => {
    expect(validateLessonFields({ title: '   ', duration: '', isFreePreview: false })).toMatchObject({ ok: false, errors: { title: 'Informe o título da aula.' } })
    const result = validateLessonFields({ title: 'x'.repeat(201), duration: '', isFreePreview: false })
    expect(result).toMatchObject({ ok: false, errors: { title: 'O título deve ter no máximo 200 caracteres.' } })
  })

  it('reports an invalid duration', () => {
    expect(validateLessonFields({ title: 'A', duration: '0', isFreePreview: false })).toMatchObject({
      ok: false,
      errors: { duration: 'A duração deve ser um número inteiro de segundos entre 1 e 86400.' },
    })
  })
})
