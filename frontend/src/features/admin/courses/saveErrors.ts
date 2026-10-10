import { AdminCoursesApiError, SESSION_EXPIRED_MESSAGE } from './api'

// Código estável do servidor -> mensagem para a equipe.
export function describeSaveError(error: unknown): string {
  switch (error instanceof AdminCoursesApiError ? error.code : 'internal') {
    case 'forbidden':
      return 'Você não tem permissão para esta alteração.'
    case 'stale_target':
      return 'Este curso foi alterado por outra pessoa. Os dados foram recarregados; revise e salve novamente.'
    case 'invalid_input':
      return 'Os dados informados são inválidos. Revise os campos e tente novamente.'
    case 'not_found':
      return 'Curso não encontrado.'
    case 'unauthorized':
      return SESSION_EXPIRED_MESSAGE
    default:
      return 'Não foi possível salvar o curso. Tente novamente.'
  }
}
