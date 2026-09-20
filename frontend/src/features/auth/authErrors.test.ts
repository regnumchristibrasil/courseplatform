import { describe, expect, it } from 'vitest'
import { toFriendlyAuthMessage } from './authErrors'

describe('toFriendlyAuthMessage', () => {
  it('translates a known Supabase auth error into a friendly Portuguese message', () => {
    expect(toFriendlyAuthMessage('Invalid login credentials')).toBe('E-mail ou senha inválidos.')
  })

  it('translates the "already registered" error', () => {
    expect(toFriendlyAuthMessage('User already registered')).toBe(
      'Este e-mail já está cadastrado.',
    )
  })

  it('translates the "email not confirmed" error', () => {
    expect(toFriendlyAuthMessage('Email not confirmed')).toMatch(/confirm/i)
  })

  it('falls back to a generic friendly message for an unknown error', () => {
    expect(toFriendlyAuthMessage('some obscure provider-specific string')).toBe(
      'Ocorreu um erro inesperado. Tente novamente.',
    )
  })

  it('falls back to a generic friendly message when given undefined', () => {
    expect(toFriendlyAuthMessage(undefined)).toBe('Ocorreu um erro inesperado. Tente novamente.')
  })
})
