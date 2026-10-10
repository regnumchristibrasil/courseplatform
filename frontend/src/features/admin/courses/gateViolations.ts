import { GATE_VIOLATION_CODES, type GateViolation, type GateViolationCode } from '../../../contracts/adminCourses'

function isCode(value: unknown): value is GateViolationCode {
  return typeof value === 'string' && (GATE_VIOLATION_CODES as readonly string[]).includes(value)
}

function toViolation(item: unknown): GateViolation | null {
  if (typeof item !== 'object' || item === null) return null
  const { code, lessonId } = item as Record<string, unknown>
  if (!isCode(code)) return null
  if (code !== 'lesson_without_video') return { code }
  return typeof lessonId === 'string' && lessonId !== '' ? { code, lessonId } : null
}

// Aceita o array do envelope da Edge Function ou o DETAIL (string JSON) de um erro
// de RPC direto. Dado não confiável: só códigos conhecidos passam; o resto vira [].
export function parseGateViolations(raw: unknown): readonly GateViolation[] {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const violation = toViolation(item)
    return violation === null ? [] : [violation]
  })
}

// lessonTitles: id da aula -> título, montado a partir da árvore já carregada.
export function describeGateViolation(violation: GateViolation, lessonTitles: ReadonlyMap<string, string>): string {
  switch (violation.code) {
    case 'price_missing':
      return 'Defina o preço do curso (somente admin ou superadmin altera o preço).'
    case 'no_active_lesson':
      return 'Adicione ao menos uma aula ativa, em um módulo ativo.'
    case 'lesson_without_video': {
      const title = violation.lessonId === undefined ? undefined : lessonTitles.get(violation.lessonId)
      return title === undefined ? 'Uma aula ativa está sem vídeo.' : `A aula "${title}" está sem vídeo.`
    }
  }
}
