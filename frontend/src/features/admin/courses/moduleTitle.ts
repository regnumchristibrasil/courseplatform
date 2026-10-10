import { MAX_MODULE_TITLE_LENGTH } from '../../../contracts/adminCourses'

// Mesma regra do servidor: título aparado, 1..200 caracteres.
export function validateModuleTitle(raw: string): string | null {
  const title = raw.trim()
  if (title === '') return 'Informe o título do módulo.'
  if ([...title].length > MAX_MODULE_TITLE_LENGTH) return `O título deve ter no máximo ${MAX_MODULE_TITLE_LENGTH} caracteres.`
  return null
}
