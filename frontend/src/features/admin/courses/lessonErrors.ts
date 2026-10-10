import { AdminCoursesApiError, SESSION_EXPIRED_MESSAGE } from './api'

// Código estável do servidor -> mensagem para a equipe (gestão de aulas).
export function describeLessonError(error: unknown): string {
  switch (error instanceof AdminCoursesApiError ? error.code : 'internal') {
    case 'forbidden':
      return 'Você não tem permissão para esta alteração.'
    case 'stale_target':
      return 'Esta aula, ou a ordem das aulas do módulo, foi alterada por outra pessoa. Os dados foram recarregados; revise e tente novamente.'
    case 'invalid_input':
      return 'Os dados informados são inválidos. Revise os campos e tente novamente.'
    case 'not_found':
      return 'Aula ou módulo não encontrado. Os dados foram recarregados.'
    case 'course_has_sales':
      return 'Este curso tem matrículas ou pedidos, então suas aulas só podem ser arquivadas.'
    case 'publish_gate_violated':
      return 'Em um curso publicado, toda aula ativa precisa de um vídeo. Crie a aula arquivada primeiro ou defina o vídeo antes de ativá-la.'
    case 'unauthorized':
      return SESSION_EXPIRED_MESSAGE
    default:
      return 'Não foi possível concluir a alteração. Tente novamente.'
  }
}
