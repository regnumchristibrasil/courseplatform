import type { CourseStatus } from '../../../contracts/adminCourses'

export const STATUS_LABELS: Readonly<Record<CourseStatus, string>> = {
  draft: 'Rascunho',
  published: 'Publicado',
  archived: 'Arquivado',
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatPrice(priceCents: number): string {
  return BRL.format(priceCents / 100).replace(/ /g, ' ')
}

export function formatAccessDuration(days: number | null): string {
  if (days === null) return 'Vitalício'
  return days === 1 ? '1 dia' : `${days} dias`
}
