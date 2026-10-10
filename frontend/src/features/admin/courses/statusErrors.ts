import { AdminCoursesApiError, SESSION_EXPIRED_MESSAGE } from './api'

export const GATE_INTRO = 'O curso não atende aos requisitos de publicação:'

// Código estável do servidor -> mensagem (status e exclusão de curso). A lista de
// pendências do portão é renderizada à parte (ver CourseStatusActions).
export function describeStatusError(error: unknown): string {
  switch (error instanceof AdminCoursesApiError ? error.code : 'internal') {
    case 'forbidden':
      return 'Você não tem permissão para esta alteração.'
    case 'stale_target':
      return 'Este curso foi alterado por outra pessoa. Os dados foram recarregados; revise e tente novamente.'
    case 'invalid_transition':
      return 'Esta transição de status não é permitida para o estado atual do curso. Os dados foram recarregados.'
    case 'publish_gate_violated':
      return `${GATE_INTRO} defina o preço e mantenha ao menos uma aula ativa, todas com vídeo.`
    case 'course_has_sales':
      return 'Este curso tem matrículas ou pedidos e não pode ser excluído. Arquive-o em vez disso.'
    case 'not_found':
      return 'Curso não encontrado. Os dados foram recarregados.'
    case 'unauthorized':
      return SESSION_EXPIRED_MESSAGE
    default:
      return 'Não foi possível concluir a alteração. Tente novamente.'
  }
}
