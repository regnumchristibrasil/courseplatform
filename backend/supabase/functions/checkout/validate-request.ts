// Hand-rolled validation for the checkout request body. No schema library
// (zod/valibot/etc.) is wired into this repo's deno.json yet -- this
// matches the plain-TS-guard style already used in `_shared/config.ts`
// (`requireEnv`/`parseIntOrNull`) rather than introducing a new dependency
// for a single two-field check.

export interface CheckoutRequestBody {
  readonly courseId: string;
}

export class InvalidCheckoutRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCheckoutRequestError';
  }
}

export function validateCheckoutRequestBody(body: unknown): CheckoutRequestBody {
  if (typeof body !== 'object' || body === null) {
    throw new InvalidCheckoutRequestError('Request body must be a JSON object');
  }
  const courseId = (body as Record<string, unknown>).courseId;
  if (typeof courseId !== 'string' || courseId.trim().length === 0) {
    throw new InvalidCheckoutRequestError('courseId is required and must be a non-empty string');
  }
  return { courseId };
}
