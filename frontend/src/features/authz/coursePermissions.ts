import { evaluateCoursePermission, type CourseAction } from '../../contracts/adminCourses'
import type { Role } from '../../contracts/adminUsers'

// UX apenas: o servidor (RPCs) reforça toda regra novamente. Nenhuma regra é
// duplicada aqui; tudo delega para o contrato compartilhado.
export function canPerformCourseAction(role: Role, action: CourseAction): boolean {
  return evaluateCoursePermission(role, action)
}

// Equipe de cursos = tutor, admin e superadmin (ADR 0002, decisão 4).
export function isCourseStaffRole(role: Role): boolean {
  return canPerformCourseAction(role, 'list')
}
