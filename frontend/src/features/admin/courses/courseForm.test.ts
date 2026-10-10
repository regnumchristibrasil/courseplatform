import { describe, expect, it } from 'vitest'
import { formatPriceInput, parsePriceToCents, toFieldsInput, validateCourseForm, type CourseFormValues } from './courseForm'

const VALID: CourseFormValues = { title: 'Curso', description: '', price: '199,90', accessDurationDays: '30' }

describe('parsePriceToCents', () => {
  it.each([
    ['199', 19900],
    ['199,9', 19990],
    ['199,90', 19990],
    ['1.999,90', 199990],
    ['100.000,00', 10_000_000],
    ['0,01', 1],
    [' 10 ', 1000],
  ])('parses %s', (input, cents) => expect(parsePriceToCents(input)).toBe(cents))

  it('treats blank as no price', () => expect(parsePriceToCents('  ')).toBeNull())

  it.each(['abc', '1,234', '1.99', '-5', '10,5,2', 'R$ 10', '1e3'])('rejects %s', (input) =>
    expect(parsePriceToCents(input)).toBe('invalid'),
  )
})

describe('formatPriceInput', () => {
  it('formats cents for editing and blank for null', () => {
    expect(formatPriceInput(19990)).toBe('199,90')
    expect(formatPriceInput(100)).toBe('1,00')
    expect(formatPriceInput(null)).toBe('')
  })
})

describe('validateCourseForm', () => {
  const draft = { priceRequired: false, canEditCommercial: true }

  it('accepts a valid form', () => expect(validateCourseForm(VALID, draft)).toEqual({}))

  it('requires a title up to 200 characters', () => {
    expect(validateCourseForm({ ...VALID, title: '   ' }, draft).title).toBe('Informe o título do curso.')
    expect(validateCourseForm({ ...VALID, title: 'x'.repeat(201) }, draft).title).toBe('O título deve ter no máximo 200 caracteres.')
  })

  it('limits the description', () => {
    expect(validateCourseForm({ ...VALID, description: 'x'.repeat(5001) }, draft).description).toBe('A descrição deve ter no máximo 5000 caracteres.')
  })

  it('allows an empty price in draft but not when a price is required', () => {
    expect(validateCourseForm({ ...VALID, price: '' }, draft)).toEqual({})
    expect(validateCourseForm({ ...VALID, price: '' }, { ...draft, priceRequired: true }).price).toBe('Informe o preço do curso.')
  })

  it('rejects zero, above R$ 100.000,00 and malformed prices', () => {
    expect(validateCourseForm({ ...VALID, price: '0' }, draft).price).toBe('O preço deve ser maior que zero.')
    expect(validateCourseForm({ ...VALID, price: '100.000,01' }, draft).price).toBe('O preço deve ser de até R$ 100.000,00.')
    expect(validateCourseForm({ ...VALID, price: 'abc' }, draft).price).toBe('Informe um valor válido, como 199,90.')
  })

  it('accepts blank duration (lifetime) and rejects out-of-range or non-integer values', () => {
    expect(validateCourseForm({ ...VALID, accessDurationDays: '' }, draft)).toEqual({})
    expect(validateCourseForm({ ...VALID, accessDurationDays: '0' }, draft).accessDurationDays).toBe('A duração deve ser de 1 a 36500 dias.')
    expect(validateCourseForm({ ...VALID, accessDurationDays: '36501' }, draft).accessDurationDays).toBe('A duração deve ser de 1 a 36500 dias.')
    expect(validateCourseForm({ ...VALID, accessDurationDays: '1.5' }, draft).accessDurationDays).toBe('A duração deve ser de 1 a 36500 dias.')
  })

  it('does not validate commercial fields the actor cannot edit', () => {
    const errors = validateCourseForm({ ...VALID, price: 'abc', accessDurationDays: 'x' }, { ...draft, canEditCommercial: false })
    expect(errors).toEqual({})
  })
})

describe('toFieldsInput', () => {
  it('maps form values to the contract (trimmed title, blank description to null)', () => {
    expect(toFieldsInput({ ...VALID, title: '  Curso  ', accessDurationDays: '' }, null)).toEqual({
      title: 'Curso',
      description: null,
      priceCents: 19990,
      accessDurationDays: null,
    })
  })

  it('keeps the original commercial values when the actor cannot edit them', () => {
    const original = { priceCents: 5000, accessDurationDays: 10 }
    expect(toFieldsInput({ ...VALID, price: '1', accessDurationDays: '2' }, original)).toMatchObject({ priceCents: 5000, accessDurationDays: 10 })
  })
})
