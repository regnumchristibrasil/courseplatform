// Request body handling for `outbox-drain`. The frozen contract is
// `{ limit?: number }` -- every field is optional, so `index.ts` treats an
// empty/malformed body as `{}` rather than a 400 (see the `BodyParseError`
// handling there). This module only owns turning that already-defaulted
// body into a clamped, DB-query-ready limit.
//
// Deliberately NOT importing `payments-reconcile/body.ts` -- it is
// function-private to that directory (same convention this repo uses
// elsewhere: each function owns its own request-shaping helpers even when
// the shape is nearly identical). The only difference from that module is
// the NFR-driven constant: outbox drain batches are capped at 50, not 100.

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50; // NFR: email outbox drain batch size <= 50.

export interface DrainRequestBody {
  readonly limit?: unknown;
}

export class InvalidLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLimitError';
  }
}

// Clamps to [MIN_LIMIT, MAX_LIMIT] -- both the default (no `limit` sent) and
// an explicit, valid `limit` go through the same clamp. Rejects a present
// but non-positive-integer `limit` outright rather than silently clamping
// it -- that shape of input signals a caller bug worth surfacing, not noise
// to paper over.
export function resolveEffectiveLimit(body: DrainRequestBody): number {
  if (body.limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (
    typeof body.limit !== 'number' || !Number.isInteger(body.limit) ||
    body.limit < 1
  ) {
    throw new InvalidLimitError('limit must be a positive integer');
  }
  return Math.min(Math.max(MIN_LIMIT, body.limit), MAX_LIMIT);
}
