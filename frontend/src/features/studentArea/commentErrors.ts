import { COMMENT_MAX_LENGTH } from '../../contracts/studentArea'
import { StudentAreaApiError } from './commentsApi'

const MESSAGES = {
  rate_limited: 'Aguarde um instante antes de comentar de novo.',
  forbidden: 'Você não pode comentar nesta aula.',
  invalid_input: 'O comentário deve ter entre 1 e 2.000 caracteres.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
} as const

const GENERIC_MESSAGE = 'Não foi possível publicar o comentário. Tente novamente.'

const REPLY_INVALID_MESSAGE = `Não foi possível responder: confira o texto (no máximo ${COMMENT_MAX_LENGTH.toLocaleString('pt-BR')} caracteres) ou se o comentário ainda existe.`

export function commentErrorMessage(error: unknown, isReply = false): string {
  if (!(error instanceof StudentAreaApiError)) return GENERIC_MESSAGE
  return isReply && error.code === 'invalid_input' ? REPLY_INVALID_MESSAGE : MESSAGES[error.code]
}

const DELETE_GENERIC_MESSAGE = 'Não foi possível excluir o comentário. Tente novamente.'

export function deleteErrorMessage(error: unknown): string {
  if (!(error instanceof StudentAreaApiError)) return DELETE_GENERIC_MESSAGE
  if (error.code === 'forbidden') return 'Você não pode excluir este comentário.'
  if (error.code === 'unauthorized') return MESSAGES.unauthorized
  return DELETE_GENERIC_MESSAGE
}
