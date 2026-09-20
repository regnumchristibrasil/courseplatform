// Request body handling for `payments-reconcile`. The frozen contract is
// `{ limit?: number }` -- every field is optional, which is why `index.ts`
// treats an empty/malformed body as `{}` rather than a 400 (see the
// `BodyParseError` handling there). This module only owns turning that
// already-defaulted body into a clamped, DB-query-ready limit.

const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100; // NFR: reconciliation batch size <= 100.

export interface ReconcileRequestBody {
  readonly limit?: unknown;
}

export class InvalidLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLimitError';
  }
}

// Clamps to [MIN_LIMIT, MAX_LIMIT] -- both the default (no `limit` sent) and
// an explicit, valid `limit` go through the same clamp, per the spec's
// `Math.min(Math.max(1, requestedLimit ?? 100), 100)`. Rejects a present but
// non-positive-integer `limit` outright rather than silently clamping it --
// that shape of input signals a caller bug worth surfacing, not noise to
// paper over.
export function resolveEffectiveLimit(body: ReconcileRequestBody): number {
  if (body.limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1) {
    throw new InvalidLimitError('limit must be a positive integer');
  }
  return Math.min(Math.max(MIN_LIMIT, body.limit), MAX_LIMIT);
}
