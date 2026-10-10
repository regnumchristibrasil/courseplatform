import { describe, expect, it } from 'vitest'
import { validateModuleTitle } from './moduleTitle'

describe('validateModuleTitle', () => {
  it('accepts a trimmed title of 1..200 characters', () => {
    expect(validateModuleTitle('  Introdução ')).toBeNull()
    expect(validateModuleTitle('x'.repeat(200))).toBeNull()
  })

  it('rejects blank and over-long titles', () => {
    expect(validateModuleTitle(' \t\n')).toBe('Informe o título do módulo.')
    expect(validateModuleTitle('x'.repeat(201))).toMatch(/no máximo 200/)
  })
})
