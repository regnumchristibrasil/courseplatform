// Deliberately simple format check — the source of truth for "is this a
// valid email" is Supabase Auth itself; this only exists to fail fast with a
// friendly message before making a network call, not to be RFC 5322-complete.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

export const MIN_PASSWORD_LENGTH = 6

export function isValidPassword(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH
}
