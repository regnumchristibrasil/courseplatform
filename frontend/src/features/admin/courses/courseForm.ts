import {
  MAX_ACCESS_DURATION_DAYS,
  MAX_COURSE_DESCRIPTION_LENGTH,
  MAX_COURSE_TITLE_LENGTH,
  MAX_PRICE_CENTS,
  MIN_ACCESS_DURATION_DAYS,
  MIN_PRICE_CENTS,
  type CourseFieldsInput,
} from '../../../contracts/adminCourses'

export interface CourseFormValues {
  readonly title: string
  readonly description: string
  readonly price: string // "1.999,90"; blank = no price
  readonly accessDurationDays: string // blank = lifetime
}

export type CourseFormErrors = Partial<Record<keyof CourseFormValues, string>>

export interface CourseFormRules {
  readonly priceRequired: boolean // published courses must keep a price
  readonly canEditCommercial: boolean // false for tutor: price/duration are read-only
}

export interface CommercialFields {
  readonly priceCents: number | null
  readonly accessDurationDays: number | null
}

const CENTS_PER_REAL = 100
const PRICE_PATTERN = /^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/
const INTEGER_PATTERN = /^\d+$/

// Blank = no price; 'invalid' = not a BRL amount in the pt-BR format.
export function parsePriceToCents(input: string): number | null | 'invalid' {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (!PRICE_PATTERN.test(trimmed)) return 'invalid'
  const [integerPart = '', decimalPart = ''] = trimmed.replace(/\./g, '').split(',')
  return Number(integerPart) * CENTS_PER_REAL + Number(decimalPart.padEnd(2, '0'))
}

export function formatPriceInput(cents: number | null): string {
  if (cents === null) return ''
  const reais = Math.floor(cents / CENTS_PER_REAL)
  return `${reais},${String(cents % CENTS_PER_REAL).padStart(2, '0')}`
}

function parseDuration(input: string): number | null | 'invalid' {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (!INTEGER_PATTERN.test(trimmed)) return 'invalid'
  const days = Number(trimmed)
  return days < MIN_ACCESS_DURATION_DAYS || days > MAX_ACCESS_DURATION_DAYS ? 'invalid' : days
}

function priceError(price: string, required: boolean): string | undefined {
  const cents = parsePriceToCents(price)
  if (cents === 'invalid') return 'Informe um valor válido, como 199,90.'
  if (cents === null) return required ? 'Informe o preço do curso.' : undefined
  if (cents < MIN_PRICE_CENTS) return 'O preço deve ser maior que zero.'
  if (cents > MAX_PRICE_CENTS) return 'O preço deve ser de até R$ 100.000,00.'
  return undefined
}

// Espelha as regras do servidor (app_private.assert_valid_course_fields);
// o servidor continua sendo a autoridade.
export function validateCourseForm(values: CourseFormValues, rules: CourseFormRules): CourseFormErrors {
  const errors: { -readonly [K in keyof CourseFormValues]?: string } = {}
  const title = values.title.trim()
  if (title === '') errors.title = 'Informe o título do curso.'
  else if ([...title].length > MAX_COURSE_TITLE_LENGTH) errors.title = `O título deve ter no máximo ${MAX_COURSE_TITLE_LENGTH} caracteres.`
  if ([...values.description].length > MAX_COURSE_DESCRIPTION_LENGTH) {
    errors.description = `A descrição deve ter no máximo ${MAX_COURSE_DESCRIPTION_LENGTH} caracteres.`
  }
  if (rules.canEditCommercial) {
    const price = priceError(values.price, rules.priceRequired)
    if (price) errors.price = price
    if (parseDuration(values.accessDurationDays) === 'invalid') {
      errors.accessDurationDays = `A duração deve ser de ${MIN_ACCESS_DURATION_DAYS} a ${MAX_ACCESS_DURATION_DAYS} dias.`
    }
  }
  return errors
}

// `original` presente = o ator não edita campos comerciais: reenvia os atuais.
export function toFieldsInput(values: CourseFormValues, original: CommercialFields | null): CourseFieldsInput {
  const description = values.description.trim()
  const commercial = original ?? {
    priceCents: parsePriceToCents(values.price) as number | null,
    accessDurationDays: parseDuration(values.accessDurationDays) as number | null,
  }
  return {
    title: values.title.trim(),
    description: description === '' ? null : values.description,
    ...commercial,
  }
}
