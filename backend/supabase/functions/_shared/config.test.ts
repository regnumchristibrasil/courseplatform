import { assertEquals, assertThrows } from '@std/assert';
import { ConfigValidationError, loadBackendConfig, optionalEnv, requireEnv } from './config.ts';

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MERCADOPAGO_ACCESS_TOKEN: 'mp-access-token',
    MERCADOPAGO_WEBHOOK_SECRET: 'mp-webhook-secret',
    MERCADOPAGO_NOTIFICATION_URL: 'https://example.com/functions/v1/payments-webhook',
    RESEND_API_KEY: 'resend-key',
    RESEND_FROM_EMAIL: 'no-reply@example.com',
    RESEND_REPLY_TO: 'support@example.com',
    POSTHOG_API_KEY: 'posthog-key',
    POSTHOG_HOST: 'https://us.i.posthog.com',
    CRON_SECRET: 'cron-secret',
    APP_PUBLIC_URL: 'https://example.com',
    COMPANY_NAME: 'Acme Courses',
    SUPPORT_EMAIL: 'support@example.com',
    ...overrides,
  };
}

Deno.test('requireEnv returns the value when present', () => {
  assertEquals(requireEnv('FOO', { FOO: 'bar' }), 'bar');
});

Deno.test('requireEnv throws when the variable is missing', () => {
  assertThrows(() => requireEnv('FOO', {}), Error, 'FOO');
});

Deno.test('requireEnv throws when the variable is an empty string', () => {
  assertThrows(() => requireEnv('FOO', { FOO: '' }), Error, 'FOO');
});

Deno.test('optionalEnv falls back when missing', () => {
  assertEquals(optionalEnv('FOO', 'fallback', {}), 'fallback');
});

Deno.test('optionalEnv returns the value when present', () => {
  assertEquals(optionalEnv('FOO', 'fallback', { FOO: 'set' }), 'set');
});

Deno.test('loadBackendConfig loads a fully valid environment with defaults applied', () => {
  const config = loadBackendConfig(baseEnv());
  assertEquals(config.paymentProvider, 'mercadopago');
  assertEquals(config.pixChargeTtlSeconds, 1800);
  assertEquals(config.videoProvider, 'youtube');
  assertEquals(config.mercadoPago.accessToken, 'mp-access-token');
  assertEquals(config.mercadoPago.webhookSecret, 'mp-webhook-secret');
  assertEquals(
    config.mercadoPago.notificationUrl,
    'https://example.com/functions/v1/payments-webhook',
  );
  assertEquals(config.resend.apiKey, 'resend-key');
  assertEquals(config.resend.fromEmail, 'no-reply@example.com');
  assertEquals(config.resend.replyTo, 'support@example.com');
  assertEquals(config.postHog.apiKey, 'posthog-key');
  assertEquals(config.postHog.host, 'https://us.i.posthog.com');
  assertEquals(config.cronSecret, 'cron-secret');
  assertEquals(config.appPublicUrl, 'https://example.com');
  assertEquals(config.companyName, 'Acme Courses');
  assertEquals(config.supportEmail, 'support@example.com');
  assertEquals(config.panda.apiKey, null);
  assertEquals(config.panda.signedUrlTtlSeconds, null);
});

Deno.test('loadBackendConfig honors an explicit PIX_CHARGE_TTL_SECONDS override', () => {
  const config = loadBackendConfig(baseEnv({ PIX_CHARGE_TTL_SECONDS: '900' }));
  assertEquals(config.pixChargeTtlSeconds, 900);
});

Deno.test('loadBackendConfig rejects a non-integer PIX_CHARGE_TTL_SECONDS', () => {
  assertThrows(
    () => loadBackendConfig(baseEnv({ PIX_CHARGE_TTL_SECONDS: 'not-a-number' })),
    ConfigValidationError,
  );
});

Deno.test('loadBackendConfig rejects an unsupported PAYMENT_PROVIDER value', () => {
  assertThrows(
    () => loadBackendConfig(baseEnv({ PAYMENT_PROVIDER: 'efi' })),
    ConfigValidationError,
    'PAYMENT_PROVIDER',
  );
});

Deno.test('loadBackendConfig rejects an unsupported VIDEO_PROVIDER value', () => {
  assertThrows(
    () => loadBackendConfig(baseEnv({ VIDEO_PROVIDER: 'vimeo' })),
    ConfigValidationError,
    'VIDEO_PROVIDER',
  );
});

Deno.test('loadBackendConfig requires PANDA_API_KEY when VIDEO_PROVIDER=panda', () => {
  assertThrows(
    () => loadBackendConfig(baseEnv({ VIDEO_PROVIDER: 'panda' })),
    ConfigValidationError,
    'PANDA_API_KEY',
  );
});

Deno.test('loadBackendConfig accepts VIDEO_PROVIDER=panda when panda vars are set', () => {
  const config = loadBackendConfig(baseEnv({
    VIDEO_PROVIDER: 'panda',
    PANDA_API_KEY: 'panda-key',
    PANDA_SIGNED_URL_TTL_SECONDS: '600',
  }));
  assertEquals(config.videoProvider, 'panda');
  assertEquals(config.panda.apiKey, 'panda-key');
  assertEquals(config.panda.signedUrlTtlSeconds, 600);
});

Deno.test('loadBackendConfig aggregates every missing required var into one error', () => {
  try {
    loadBackendConfig({});
    throw new Error('expected loadBackendConfig to throw');
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) throw error;
    assertEquals(error.missing.includes('MERCADOPAGO_ACCESS_TOKEN'), true);
    assertEquals(error.missing.includes('RESEND_API_KEY'), true);
    assertEquals(error.missing.includes('POSTHOG_API_KEY'), true);
    assertEquals(error.missing.includes('CRON_SECRET'), true);
  }
});

Deno.test('loadBackendConfig never requires SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY -- those are auto-injected', () => {
  // Sanity check that the base fixture (which never sets these) still loads.
  const config = loadBackendConfig(baseEnv());
  assertEquals(typeof config, 'object');
});
