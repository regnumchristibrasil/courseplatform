import {
  GATE_VIOLATION_CODES,
  type GateViolation,
  type GateViolationCode,
} from '../../../contracts/adminCourses.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCode(value: unknown): value is GateViolationCode {
  return typeof value === 'string' && (GATE_VIOLATION_CODES as readonly string[]).includes(value);
}

function toViolation(item: unknown): GateViolation | null {
  if (typeof item !== 'object' || item === null) return null;
  const { code, lessonId } = item as Record<string, unknown>;
  if (!isCode(code)) return null;
  if (code !== 'lesson_without_video') return { code };
  return typeof lessonId === 'string' && UUID_PATTERN.test(lessonId) ? { code, lessonId } : null;
}

// O DETAIL da excecao CR004 e um array JSON gerado pelo banco. E tratado como
// dado nao confiavel: so passam codigos conhecidos e ids em formato de uuid;
// qualquer outra coisa resulta em lista vazia (a UI mostra a mensagem generica).
export function parseGateViolations(details: unknown): readonly GateViolation[] {
  if (typeof details !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const violation = toViolation(item);
      return violation === null ? [] : [violation];
    });
  } catch {
    return [];
  }
}
