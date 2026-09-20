import { describe, expect, it } from 'vitest'
import { formatAccessDuration, formatCentsToBRL } from './format'

describe('formatCentsToBRL', () => {
  it('formats a typical price in cents as BRL currency', () => {
    expect(formatCentsToBRL(19900)).toBe('R$ 199,00')
  })

  it('formats zero cents', () => {
    expect(formatCentsToBRL(0)).toBe('R$ 0,00')
  })

  it('formats a value under one real using leading zero cents', () => {
    expect(formatCentsToBRL(50)).toBe('R$ 0,50')
  })

  it('formats a large value with thousands separators', () => {
    expect(formatCentsToBRL(123456789)).toBe('R$ 1.234.567,89')
  })
})

describe('formatAccessDuration', () => {
  it('describes a null duration as lifetime access', () => {
    expect(formatAccessDuration(null)).toBe('Acesso vitalício')
  })

  it('uses the singular day form for a 1-day duration', () => {
    expect(formatAccessDuration(1)).toBe('Acesso por 1 dia')
  })

  it('uses the plural day form for a multi-day duration', () => {
    expect(formatAccessDuration(365)).toBe('Acesso por 365 dias')
  })
})
