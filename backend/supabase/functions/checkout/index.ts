// `checkout` Edge Function entrypoint. Deliberately thin: build real
// collaborators once at module scope (cold-start fail-fast, per
// `_shared/config.ts`'s convention) and delegate to `handleCheckoutRequest`
// (`handler.ts`), which holds all the testable logic. Kept separate from
// `handler.ts` so `deno test` never imports this file -- calling
// `Deno.serve` at module scope during a test run would require `--allow-net`,
// which this repo's `deno task test` intentionally does not grant.
//
// verify_jwt: true (Supabase's default -- not overridden in config.toml),
// so an unauthenticated request never reaches this handler.

import { loadBackendConfig } from '../_shared/config.ts';
import { createCallerClient, createServiceRoleClient } from '../_shared/supabase.ts';
import { captureAndFlush, captureExceptionAndFlush } from '../_shared/observability.ts';
import { MercadoPagoProvider } from '../_shared/payments/mercadopago/provider.ts';
import { type CheckoutDeps, handleCheckoutRequest } from './handler.ts';

const config = loadBackendConfig();

const paymentProvider = new MercadoPagoProvider({
  accessToken: config.mercadoPago.accessToken,
  webhookSecret: config.mercadoPago.webhookSecret,
});

const deps: CheckoutDeps = {
  config,
  createCallerClient,
  createServiceRoleClient,
  paymentProvider,
  captureAndFlush,
  captureExceptionAndFlush,
};

Deno.serve((request) => handleCheckoutRequest(request, deps));
