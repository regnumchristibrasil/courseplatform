import { describe, expect, it } from 'vitest'
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from './validators'

describe('isValidEmail', () => {
  it('accepts a well-formed email', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
  })

  it('accepts an email with a subdomain and a plus tag', () => {
    expect(isValidEmail('user+tag@mail.example.com')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidEmail('')).toBe(false)
  })

  it('rejects a whitespace-only string', () => {
    expect(isValidEmail('   ')).toBe(false)
  })

  it('rejects a string missing the @ separator', () => {
    expect(isValidEmail('user.example.com')).toBe(false)
  })

  it('rejects a string missing a domain', () => {
    expect(isValidEmail('user@')).toBe(false)
  })

  it('rejects a string with spaces inside it', () => {
    expect(isValidEmail('user name@example.com')).toBe(false)
  })

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  user@example.com  ')).toBe(true)
  })
})

describe('isValidPassword', () => {
  it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(isValidPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false)
  })

  it(`accepts a password exactly ${MIN_PASSWORD_LENGTH} characters long (boundary)`, () => {
    expect(isValidPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true)
  })

  it('accepts a long password', () => {
    expect(isValidPassword('a'.repeat(64))).toBe(true)
  })

  it('rejects an empty password', () => {
    expect(isValidPassword('')).toBe(false)
  })
})
