import { describe, expect, it } from 'vitest'
import type { GateViolation } from '../../../contracts/adminCourses'
import { describeGateViolation, parseGateViolations } from './gateViolations'

describe('parseGateViolations', () => {
  it('keeps known codes and lesson ids, dropping anything else', () => {
    expect(
      parseGateViolations([
        { code: 'price_missing' },
        { code: 'no_active_lesson' },
        { code: 'lesson_without_video', lessonId: 'l1' },
        { code: 'lesson_without_video' },
        { code: 'lesson_without_video', lessonId: 5 },
        { code: 'other' },
        null,
        'x',
      ]),
    ).toEqual([{ code: 'price_missing' }, { code: 'no_active_lesson' }, { code: 'lesson_without_video', lessonId: 'l1' }])
  })

  it('accepts a JSON string (PostgREST details) and tolerates garbage', () => {
    expect(parseGateViolations('[{"code":"price_missing"}]')).toEqual([{ code: 'price_missing' }])
    expect(parseGateViolations('not json')).toEqual([])
    expect(parseGateViolations('{"code":"price_missing"}')).toEqual([])
    expect(parseGateViolations(undefined)).toEqual([])
    expect(parseGateViolations(null)).toEqual([])
  })
})

describe('describeGateViolation', () => {
  const titles = new Map([['l1', 'Introdução']])

  it('explains each violation in Portuguese', () => {
    const cases: readonly [GateViolation, RegExp][] = [
      [{ code: 'price_missing' }, /preço/i],
      [{ code: 'no_active_lesson' }, /ao menos uma aula ativa/i],
      [{ code: 'lesson_without_video', lessonId: 'l1' }, /Introdução.*vídeo/],
    ]
    for (const [violation, pattern] of cases) expect(describeGateViolation(violation, titles)).toMatch(pattern)
  })

  it('falls back when the lesson is no longer in the tree', () => {
    expect(describeGateViolation({ code: 'lesson_without_video', lessonId: 'gone' }, titles)).toMatch(/vídeo/)
  })
})
