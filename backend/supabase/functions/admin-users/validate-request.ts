import { MAX_REASON_LENGTH, type SetActiveRequest } from '../../../contracts/adminUsers.ts';

export class InvalidSetActiveRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSetActiveRequestError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'action',
  'userId',
  'active',
  'expectedActive',
  'reason',
]);

// Validacao estrita na fronteira: campos desconhecidos sao rejeitados para
// que nenhuma identidade de ator (I5) ou outro dado possa entrar pelo corpo.
export function validateSetActiveRequest(body: unknown): SetActiveRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidSetActiveRequestError('Request body must be a JSON object');
  }
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new InvalidSetActiveRequestError('Unknown fields in request body');
  }
  if (record.action !== 'set_active') {
    throw new InvalidSetActiveRequestError("action must be 'set_active'");
  }
  const { userId, active, expectedActive, reason } = record;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw new InvalidSetActiveRequestError('userId must be a uuid string');
  }
  if (typeof active !== 'boolean') {
    throw new InvalidSetActiveRequestError('active must be a boolean');
  }
  if (typeof expectedActive !== 'boolean') {
    throw new InvalidSetActiveRequestError('expectedActive must be a boolean');
  }
  if (reason !== undefined) {
    if (typeof reason !== 'string') {
      throw new InvalidSetActiveRequestError('reason must be a string');
    }
    // Code points (como char_length no Postgres), nao unidades UTF-16.
    if ([...reason].length > MAX_REASON_LENGTH) {
      throw new InvalidSetActiveRequestError(
        `reason must be at most ${MAX_REASON_LENGTH} characters`,
      );
    }
  }
  return { userId, active, expectedActive, reason: reason === '' ? undefined : reason };
}
