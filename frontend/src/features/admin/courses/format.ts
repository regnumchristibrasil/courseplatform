import type { CourseStatus, VideoProvider } from '../../../contracts/adminCourses'

export const STATUS_LABELS: Readonly<Record<CourseStatus, string>> = {
  draft: 'Rascunho',
  published: 'Publicado',
  archived: 'Arquivado',
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatPrice(priceCents: number | null): string {
  if (priceCents === null) return 'Sem preço'
  return BRL.format(priceCents / 100).replace(/ /g, ' ')
}

export function formatAccessDuration(days: number | null): string {
  if (days === null) return 'Vitalício'
  return days === 1 ? '1 dia' : `${days} dias`
}

export const PROVIDER_LABELS: Readonly<Record<VideoProvider, string>> = {
  youtube: 'YouTube',
  panda: 'Panda Video',
}

const SECONDS_PER_MINUTE = 60

export function formatLessonDuration(seconds: number | null): string {
  if (seconds === null) return 'Não informada'
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const rest = String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')
  return `${minutes}:${rest}`
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date)
}
