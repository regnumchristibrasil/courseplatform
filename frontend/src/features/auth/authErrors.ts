const GENERIC_MESSAGE = 'Ocorreu um erro inesperado. Tente novamente.'

// Supabase Auth error `message` strings are English and provider-internal;
// this maps the ones users actually hit into friendly Portuguese copy.
// Anything unmapped falls back to a generic message rather than leaking a
// raw provider string to the user.
const KNOWN_MESSAGES: Readonly<Record<string, string>> = {
  'Invalid login credentials': 'E-mail ou senha inválidos.',
  'User already registered': 'Este e-mail já está cadastrado.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
}

export function toFriendlyAuthMessage(rawMessage: string | undefined): string {
  if (!rawMessage) {
    return GENERIC_MESSAGE
  }
  return KNOWN_MESSAGES[rawMessage] ?? GENERIC_MESSAGE
}
