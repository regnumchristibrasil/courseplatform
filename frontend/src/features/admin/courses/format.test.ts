import { describe, expect, it } from 'vitest'
import { formatDateTime, formatLessonDuration } from './format'

describe('formatLessonDuration', () => {
  it.each([
    [null, 'Não informada'],
    [0, '0:00'],
    [9, '0:09'],
    [600, '10:00'],
    [3725, '62:05'],
  ])('%s -> %s', (seconds, expected) => {
    expect(formatLessonDuration(seconds)).toBe(expected)
  })
})

describe('formatDateTime', () => {
  it('formats in pt-BR and Sao Paulo time', () => {
    expect(formatDateTime('2026-01-02T15:30:00Z')).toMatch(/^02\/01\/2026,? 12:30$/)
  })

  it('returns the input when it is not a date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})
