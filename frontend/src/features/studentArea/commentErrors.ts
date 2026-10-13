import { StudentAreaApiError } from './commentsApi'

const MESSAGES = {
  rate_limited: 'Aguarde um instante antes de comentar de novo.',
  forbidden: 'Você não pode comentar nesta aula.',
  invalid_input: 'O comentário deve ter entre 1 e 2.000 caracteres.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
} as const

const GENERIC_MESSAGE = 'Não foi possível publicar o comentário. Tente novamente.'

export function commentErrorMessage(error: unknown): string {
  return error instanceof StudentAreaApiError ? MESSAGES[error.code] : GENERIC_MESSAGE
}
