// `checkout` request handler -- creates (or reuses) a PIX charge for a
// published course. Exported as a standalone, dependency-injected function
// so it is unit-testable without a live server; `index.ts` is the thin
// `Deno.serve` wrapper that supplies real collaborators.
//
// This function only *creates* charges. It never transitions an order to
// `paid` -- that happens later, from the webhook/reconcile functions
// (neither of which exist yet), via `app.confirm_payment`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreatePixChargeInput,
  PaymentProvider,
  PixCharge,
} from '../../../contracts/payments.ts';
import {
  BodyParseError,
  corsPreflightResponse,
  errorJsonResponse,
  generateRequestId,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts';
import { MissingAuthorizationError } from '../_shared/supabase.ts';
import type { BackendConfig } from '../_shared/config.ts';
import { captureAndFlush, captureExceptionAndFlush } from '../_shared/observability.ts';
import { fetchPublishedCourse } from './courses.ts';
import { findReusableOrder, insertPendingOrder, updateOrderProviderRefs } from './orders.ts';
import { buildCheckoutResponse } from './response.ts';
import {
  type CheckoutRequestBody,
  InvalidCheckoutRequestError,
  validateCheckoutRequestBody,
} from './validate-request.ts';

export interface CheckoutDeps {
  readonly config: BackendConfig;
  readonly createCallerClient: (request: Request) => SupabaseClient;
  readonly createServiceRoleClient: () => SupabaseClient;
  readonly paymentProvider: PaymentProvider;
  readonly captureAndFlush: typeof captureAndFlush;
  readonly captureExceptionAndFlush: typeof captureExceptionAndFlush;
}

function buildChargeInput(
  deps: CheckoutDeps,
  params: {
    readonly orderId: string;
    readonly amountCents: number;
    readonly courseTitle: string;
    readonly payerEmail: string;
  },
): CreatePixChargeInput {
  return {
    orderId: params.orderId,
    amount: { amountCents: params.amountCents, currency: 'BRL' },
    description: `${deps.config.companyName} - ${params.courseTitle}`,
    expiresInSeconds: deps.config.pixChargeTtlSeconds,
    payer: { email: params.payerEmail },
    notificationUrl: deps.config.mercadoPago.notificationUrl,
    // Reusing the existing order's id as the idempotency key (reuse branch)
    // or the newly-inserted order's id (new-order branch) is what should
    // make a double-click safe -- Mercado Pago's `X-Idempotency-Key` header
    // (wired in `MercadoPagoProvider`) is documented to replay the original
    // response for a repeated key.
    // ASSUMPTION FLAGGED FOR VERIFICATION (same caveat convention as
    // `_shared/payments/mercadopago/webhook.ts`'s signature-manifest note):
    // this replay behavior is inferred from Mercado Pago's public
    // idempotency-key documentation, not verified against a live/sandbox
    // call -- no real MERCADOPAGO_ACCESS_TOKEN exists in this environment.
    idempotencyKey: params.orderId,
  };
}

type ChargeOutcome = { readonly ok: true; readonly charge: PixCharge } | {
  readonly ok: false;
  readonly response: Response;
};

// Centralizes the "provider threw" error path shared by both the
// reuse-existing-order and create-new-order branches: capture the
// exception (never the raw `MercadoPagoApiError.body`, which may carry
// payer PII -- only `{ orderId, courseId }` as properties, letting
// `captureExceptionAndFlush` derive `message`/`stack` from the error
// itself) and return a generic 502, never leaking the provider's raw error
// body to the client.
async function createChargeOrError(
  deps: CheckoutDeps,
  input: CreatePixChargeInput,
  context: {
    readonly userId: string;
    readonly orderId: string;
    readonly courseId: string;
    readonly requestId: string;
  },
): Promise<ChargeOutcome> {
  try {
    const charge = await deps.paymentProvider.createPixCharge(input);
    return { ok: true, charge };
  } catch (error) {
    await deps.captureExceptionAndFlush(deps.config.postHog, {
      distinctId: context.userId,
      error,
      properties: { orderId: context.orderId, courseId: context.courseId },
    });
    return {
      ok: false,
      response: errorJsonResponse({
        code: 'payment_provider_error',
        message: 'Failed to create the PIX charge with the payment provider',
        status: 502,
        requestId: context.requestId,
      }),
    };
  }
}

interface CurrentAccessRow {
  readonly role: string;
  readonly is_active: boolean;
}

// Returns an error Response when the caller must not check out, else null.
// `app.current_access()` is granted to `authenticated` and scoped to the
// caller's own auth.uid(). No row means "no explicit access record", treated
// as active to keep pre-A21 behaviour (A18 backfills every account).
async function checkUserIsActive(
  deps: CheckoutDeps,
  callerClient: SupabaseClient,
  userId: string,
  requestId: string,
): Promise<Response | null> {
  let rows: readonly CurrentAccessRow[];
  try {
    const { data, error } = await callerClient.schema('app').rpc('current_access');
    if (error) {
      throw new Error(`app.current_access RPC failed: ${error.message}`);
    }
    rows = (data ?? []) as readonly CurrentAccessRow[];
  } catch (error) {
    await deps.captureExceptionAndFlush(deps.config.postHog, {
      distinctId: userId,
      error,
      properties: { reason: 'checkout_access_lookup_failed' },
    });
    return errorJsonResponse({
      code: 'internal_error',
      message: 'Unexpected error while processing checkout',
      status: 500,
      requestId,
    });
  }
  if (rows[0] && rows[0].is_active === false) {
    return errorJsonResponse({
      code: 'forbidden',
      message: 'This account is deactivated and cannot start a checkout',
      status: 403,
      requestId,
    });
  }
  return null;
}

export async function handleCheckoutRequest(
  request: Request,
  deps: CheckoutDeps,
): Promise<Response> {
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') {
    return corsPreflightResponse();
  }
  if (request.method !== 'POST') {
    return errorJsonResponse({
      code: 'method_not_allowed',
      message: 'Only POST is supported',
      status: 405,
      requestId,
    });
  }

  let body: CheckoutRequestBody;
  try {
    body = validateCheckoutRequestBody(await parseJsonBody<unknown>(request));
  } catch (error) {
    const message = error instanceof BodyParseError || error instanceof InvalidCheckoutRequestError
      ? error.message
      : 'Invalid request body';
    return errorJsonResponse({ code: 'invalid_body', message, status: 400, requestId });
  }

  let callerClient: SupabaseClient;
  try {
    callerClient = deps.createCallerClient(request);
  } catch (error) {
    if (error instanceof MissingAuthorizationError) {
      return errorJsonResponse({
        code: 'unauthorized',
        message: 'Missing Authorization header',
        status: 401,
        requestId,
      });
    }
    throw error;
  }

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return errorJsonResponse({
      code: 'unauthorized',
      message: 'Invalid or expired session',
      status: 401,
      requestId,
    });
  }
  const user = userData.user;
  // This app's auth is email+password only (prompt_course_platform.md,
  // "Auth & onboarding") -- every authenticated user is expected to carry
  // an email. Falling back to '' rather than throwing keeps this endpoint
  // from crashing on an edge case the current auth setup cannot actually
  // produce; Mercado Pago will just reject an empty payer email as an
  // invalid-input 4xx, which is handled as a generic provider error below.
  const payerEmail = user.email ?? '';

  // ADR 0001, decisao 5: usuario desativado nao pode iniciar checkout.
  // Fail closed: se o status nao puder ser lido, nega com 500 em vez de liberar.
  const accessOutcome = await checkUserIsActive(deps, callerClient, user.id, requestId);
  if (accessOutcome) return accessOutcome;

  const serviceClient = deps.createServiceRoleClient();

  try {
    const course = await fetchPublishedCourse(serviceClient, body.courseId);
    if (!course) {
      return errorJsonResponse({
        code: 'course_not_found',
        message: 'Course not found',
        status: 404,
        requestId,
      });
    }

    const existingOrder = await findReusableOrder(serviceClient, user.id, body.courseId);

    if (existingOrder) {
      const outcome = await createChargeOrError(
        deps,
        buildChargeInput(deps, {
          orderId: existingOrder.id,
          amountCents: existingOrder.amountCents,
          courseTitle: course.title,
          payerEmail,
        }),
        { userId: user.id, orderId: existingOrder.id, courseId: body.courseId, requestId },
      );
      if (!outcome.ok) return outcome.response;
      // Reusing an existing charge is not a NEW charge -- `payment_charge_created`
      // is only emitted on the create-new-order branch below. The frozen
      // `ServerEventName` list (observability.ts) has no distinct "reused"
      // event; adding one would be a scope decision beyond this task.
      return jsonResponse(
        buildCheckoutResponse(existingOrder.id, existingOrder.amountCents, outcome.charge),
      );
    }

    const expiresAt = new Date(Date.now() + deps.config.pixChargeTtlSeconds * 1000).toISOString();
    const orderId = await insertPendingOrder(serviceClient, {
      userId: user.id,
      courseId: body.courseId,
      amountCents: course.priceCents,
      provider: deps.config.paymentProvider,
      expiresAt,
    });

    const outcome = await createChargeOrError(
      deps,
      buildChargeInput(deps, {
        orderId,
        amountCents: course.priceCents,
        courseTitle: course.title,
        payerEmail,
      }),
      { userId: user.id, orderId, courseId: body.courseId, requestId },
    );
    if (!outcome.ok) return outcome.response;

    await updateOrderProviderRefs(serviceClient, orderId, {
      providerChargeId: outcome.charge.providerChargeId,
      providerTxid: outcome.charge.providerTxid,
      externalReference: outcome.charge.externalReference,
    });

    // Best-effort -- never let an observability failure fail the request
    // (per observability.ts's own contract: `CaptureResult.ok` is for the
    // caller to notice, not to throw on).
    await deps.captureAndFlush(deps.config.postHog, {
      event: 'payment_charge_created',
      distinctId: user.id,
      properties: { orderId, courseId: body.courseId, amountCents: course.priceCents },
    });

    return jsonResponse(buildCheckoutResponse(orderId, course.priceCents, outcome.charge));
  } catch (error) {
    // Anything reaching here is unexpected (a DB error from courses.ts /
    // orders.ts, or a bug) -- not one of this endpoint's documented error
    // paths. Best-effort capture, generic 500, never leak internals.
    await deps.captureExceptionAndFlush(deps.config.postHog, {
      distinctId: user.id,
      error,
      properties: { courseId: body.courseId },
    });
    return errorJsonResponse({
      code: 'internal_error',
      message: 'Unexpected error while processing checkout',
      status: 500,
      requestId,
    });
  }
}
