import { AdminCoursesApiError, SESSION_EXPIRED_MESSAGE } from './api'

// Código estável do servidor -> mensagem para a equipe (gestão de módulos).
export function describeModuleError(error: unknown): string {
  switch (error instanceof AdminCoursesApiError ? error.code : 'internal') {
    case 'forbidden':
      return 'Você não tem permissão para esta alteração.'
    case 'stale_target':
      return 'A estrutura do curso foi alterada por outra pessoa. Os dados foram recarregados; revise e tente novamente.'
    case 'invalid_input':
      return 'Os dados informados são inválidos. Revise os campos e tente novamente.'
    case 'not_found':
      return 'Módulo não encontrado. Os dados foram recarregados.'
    case 'module_not_empty':
      return 'Este módulo ainda tem aulas e não pode ser excluído. Arquive-o ou retire as aulas antes.'
    case 'publish_gate_violated':
      return 'Em um curso publicado, é preciso manter ao menos uma aula ativa, e toda aula ativa precisa de vídeo. Despublique o curso ou ajuste as aulas antes.'
    case 'course_has_sales':
      return 'Este curso tem matrículas ou pedidos, então seus módulos só podem ser arquivados.'
    case 'unauthorized':
      return SESSION_EXPIRED_MESSAGE
    default:
      return 'Não foi possível concluir a alteração. Tente novamente.'
  }
}
