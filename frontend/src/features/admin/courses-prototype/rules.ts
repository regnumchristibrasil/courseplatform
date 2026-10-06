import type { Course, Lesson, Video } from './types'

// Decided in #6: price > 0 with a ceiling (R$ 100.000,00).
export const MAX_PRICE_CENTS = 10_000_000

export function activeLessons(course: Course): readonly Lesson[] {
  return course.modules.filter((m) => !m.archived).flatMap((m) => m.lessons.filter((l) => !l.archived))
}

// Decided in #3: a published course always has at least one active lesson and
// every active lesson has an active video. Archived items do not count.
export function gateViolations(course: Course): readonly string[] {
  const lessons = activeLessons(course)
  const violations: string[] = []
  if (lessons.length === 0) violations.push('O curso precisa de ao menos uma aula ativa.')
  for (const lesson of lessons) {
    if (!lesson.video) violations.push(`A aula "${lesson.title}" não tem vídeo.`)
  }
  return violations
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PANDA_EMBED = /pandavideo\.com\.br\/embed\/?\?(?:.*&)?v=([0-9a-f-]{36})/i

export type ParsedVideo =
  | { readonly ok: true; readonly video: Video }
  | { readonly ok: false; readonly message: string }

// Decided in #5: format-only validation, normalized to the canonical ref.
export function parseVideoInput(raw: string): ParsedVideo {
  const text = raw.trim()
  if (text === '') return { ok: false, message: 'Informe um ID ou URL de vídeo.' }
  const youtubeUrl = YOUTUBE_URL.exec(text)
  if (youtubeUrl?.[1]) return { ok: true, video: { provider: 'youtube', ref: youtubeUrl[1] } }
  if (YOUTUBE_ID.test(text)) return { ok: true, video: { provider: 'youtube', ref: text } }
  const pandaEmbed = PANDA_EMBED.exec(text)
  if (pandaEmbed?.[1] && UUID.test(pandaEmbed[1])) {
    return { ok: true, video: { provider: 'panda', ref: pandaEmbed[1].toLowerCase() } }
  }
  if (UUID.test(text)) return { ok: true, video: { provider: 'panda', ref: text.toLowerCase() } }
  return {
    ok: false,
    message: 'Formato não reconhecido. Use o ID ou URL do YouTube, ou o UUID ou URL de embed do Panda.',
  }
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

export function parsePrice(text: string): Parsed<number> {
  const normalized = text.trim().replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  if (normalized === '' || Number.isNaN(value)) return { ok: false, message: 'Informe um preço válido.' }
  const cents = Math.round(value * 100)
  if (cents <= 0) return { ok: false, message: 'O preço precisa ser maior que zero (curso gratuito está fora de escopo).' }
  if (cents > MAX_PRICE_CENTS) return { ok: false, message: 'O preço máximo é R$ 100.000,00.' }
  return { ok: true, value: cents }
}

export function parseAccessDuration(text: string): Parsed<number | null> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, message: 'Deixe vazio (acesso vitalício) ou informe um número inteiro de dias maior que zero.' }
  }
  return { ok: true, value }
}

export function parseLessonDuration(text: string): Parsed<number | null> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value <= 0) return { ok: false, message: 'Duração em segundos: inteiro maior que zero, ou vazio.' }
  return { ok: true, value }
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function duplicatesOf(courses: readonly Course[], video: Video, ignoreLessonId?: string): readonly string[] {
  return courses
    .flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => ({ course: c, lesson: l }))))
    .filter(({ lesson }) => lesson.id !== ignoreLessonId && lesson.video?.provider === video.provider && lesson.video.ref === video.ref)
    .map(({ course, lesson }) => `${course.title} / ${lesson.title}`)
}
