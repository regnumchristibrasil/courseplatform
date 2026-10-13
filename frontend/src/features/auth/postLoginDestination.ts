import type { SupabaseClient } from '@supabase/supabase-js'
import { STUDENT_AREA_ROUTES } from '../../contracts/studentArea'
import { fetchCurrentAccess } from '../authz/currentAccessApi'

// Só caminhos locais (um "/" não seguido de "/" ou "\\"): evita open redirect.
const LOCAL_PATH = /^\/(?![/\\])/
const DEFAULT_DESTINATION = STUDENT_AREA_ROUTES.catalog
const STUDENT_DESTINATION = STUDENT_AREA_ROUTES.myCourses

// Destino explícito (ex.: rota protegida) vale para todos. Sem ele, o aluno cai
// em /meus-cursos e a equipe mantém o destino padrão. Falha ao consultar o
// papel nunca bloqueia o login: cai no destino padrão.
export async function resolvePostLoginDestination(
  client: SupabaseClient,
  requested: string | undefined,
): Promise<string> {
  if (requested !== undefined && LOCAL_PATH.test(requested)) {
    return requested
  }
  try {
    const access = await fetchCurrentAccess(client)
    return access?.role === 'student' ? STUDENT_DESTINATION : DEFAULT_DESTINATION
  } catch (error) {
    console.warn('Post-login role lookup failed; using default destination.', error)
    return DEFAULT_DESTINATION
  }
}
