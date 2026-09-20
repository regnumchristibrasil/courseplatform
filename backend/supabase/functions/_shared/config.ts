// Typed, fail-fast access to backend environment variables.
//
// `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
// auto-injected into every deployed Supabase Edge Function runtime -- do
// NOT set them manually (no entry in `backend/.env.example`, no
// `supabase secrets set`). They are read directly by `_shared/supabase.ts`'s
// client factories, not part of `BackendConfig` below.
//
// Every function should call `loadBackendConfig()` once at module scope
// (cold start), not lazily inside the request handler -- a missing secret
// should fail the function's boot, not surface as a confusing runtime error
// on the first real request.

const DEFAULT_PAYMENT_PROVIDER = 'mercadopago';
const DEFAULT_VIDEO_PROVIDER = 'youtube';
const DEFAULT_PIX_CHARGE_TTL_SECONDS = 1800;

export type PaymentProviderName = 'mercadopago';
export type VideoProviderName = 'youtube' | 'panda';

export interface BackendConfig {
  readonly paymentProvider: PaymentProviderName;
  readonly mercadoPago: {
    readonly accessToken: string;
    readonly webhookSecret: string;
    readonly notificationUrl: string;
  };
  readonly pixChargeTtlSeconds: number;
  readonly videoProvider: VideoProviderName;
  readonly panda: {
    readonly apiKey: string | null;
    readonly signedUrlTtlSeconds: number | null;
  };
  readonly resend: {
    readonly apiKey: string;
    readonly fromEmail: string;
    readonly replyTo: string;
  };
  readonly postHog: {
    readonly apiKey: string;
    readonly host: string;
  };
  readonly cronSecret: string;
  readonly appPublicUrl: string;
  readonly companyName: string;
  readonly supportEmail: string;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class MissingEnvVarError extends Error {
  constructor(public readonly varName: string) {
    super(`Missing required environment variable: ${varName}`);
    this.name = 'MissingEnvVarError';
  }
}

export class ConfigValidationError extends Error {
  constructor(
    public readonly missing: readonly string[],
    public readonly invalid: readonly string[],
  ) {
    super(ConfigValidationError.buildMessage(missing, invalid));
    this.name = 'ConfigValidationError';
  }

  private static buildMessage(missing: readonly string[], invalid: readonly string[]): string {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`missing required environment variables: ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
      parts.push(`invalid environment variables: ${invalid.join(', ')}`);
    }
    return `Backend config validation failed -- ${parts.join('; ')}`;
  }
}

function defaultEnvSource(): EnvSource {
  return Deno.env.toObject();
}

export function requireEnv(name: string, source: EnvSource = defaultEnvSource()): string {
  const value = source[name];
  if (value === undefined || value === '') {
    throw new MissingEnvVarError(name);
  }
  return value;
}

export function optionalEnv(
  name: string,
  fallback: string,
  source: EnvSource = defaultEnvSource(),
): string {
  const value = source[name];
  return value === undefined || value === '' ? fallback : value;
}

function parseIntOrNull(name: string, raw: string, invalid: string[]): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    invalid.push(`${name} (must be an integer, got: "${raw}")`);
    return null;
  }
  return parsed;
}

// Collects every missing/invalid var into a single `ConfigValidationError`
// instead of throwing on the first one -- at cold start this surfaces the
// full list of what's misconfigured in one deploy log entry, not a
// fix-one-redeploy-repeat loop.
export function loadBackendConfig(source: EnvSource = defaultEnvSource()): BackendConfig {
  const missing: string[] = [];
  const invalid: string[] = [];

  const readRequired = (name: string): string => {
    const value = source[name];
    if (value === undefined || value === '') {
      missing.push(name);
      return '';
    }
    return value;
  };

  const paymentProviderRaw = optionalEnv('PAYMENT_PROVIDER', DEFAULT_PAYMENT_PROVIDER, source);
  if (paymentProviderRaw !== DEFAULT_PAYMENT_PROVIDER) {
    invalid.push(
      `PAYMENT_PROVIDER (only "mercadopago" is implemented, got: "${paymentProviderRaw}")`,
    );
  }

  const videoProviderRaw = optionalEnv('VIDEO_PROVIDER', DEFAULT_VIDEO_PROVIDER, source);
  if (videoProviderRaw !== 'youtube' && videoProviderRaw !== 'panda') {
    invalid.push(`VIDEO_PROVIDER (must be "youtube" or "panda", got: "${videoProviderRaw}")`);
  }
  const videoProvider = videoProviderRaw === 'panda' ? 'panda' : 'youtube';

  const mercadoPagoAccessToken = readRequired('MERCADOPAGO_ACCESS_TOKEN');
  const mercadoPagoWebhookSecret = readRequired('MERCADOPAGO_WEBHOOK_SECRET');
  const mercadoPagoNotificationUrl = readRequired('MERCADOPAGO_NOTIFICATION_URL');

  const pixChargeTtlRaw = optionalEnv(
    'PIX_CHARGE_TTL_SECONDS',
    String(DEFAULT_PIX_CHARGE_TTL_SECONDS),
    source,
  );
  const pixChargeTtlSeconds = parseIntOrNull('PIX_CHARGE_TTL_SECONDS', pixChargeTtlRaw, invalid) ??
    DEFAULT_PIX_CHARGE_TTL_SECONDS;

  // Panda credentials are only required once the operator actually opts
  // into VIDEO_PROVIDER=panda -- required for MVP's YouTube phase would
  // block every deploy on a production-phase secret that doesn't exist yet.
  let pandaApiKey: string | null = null;
  let pandaSignedUrlTtlSeconds: number | null = null;
  if (videoProvider === 'panda') {
    pandaApiKey = readRequired('PANDA_API_KEY') || null;
    const pandaTtlRaw = readRequired('PANDA_SIGNED_URL_TTL_SECONDS');
    if (pandaTtlRaw !== '') {
      pandaSignedUrlTtlSeconds = parseIntOrNull(
        'PANDA_SIGNED_URL_TTL_SECONDS',
        pandaTtlRaw,
        invalid,
      );
    }
  }

  const resendApiKey = readRequired('RESEND_API_KEY');
  const resendFromEmail = readRequired('RESEND_FROM_EMAIL');
  const resendReplyTo = readRequired('RESEND_REPLY_TO');

  const postHogApiKey = readRequired('POSTHOG_API_KEY');
  const postHogHost = readRequired('POSTHOG_HOST');

  const cronSecret = readRequired('CRON_SECRET');
  const appPublicUrl = readRequired('APP_PUBLIC_URL');
  const companyName = readRequired('COMPANY_NAME');
  const supportEmail = readRequired('SUPPORT_EMAIL');

  if (missing.length > 0 || invalid.length > 0) {
    throw new ConfigValidationError(missing, invalid);
  }

  return {
    paymentProvider: DEFAULT_PAYMENT_PROVIDER,
    mercadoPago: {
      accessToken: mercadoPagoAccessToken,
      webhookSecret: mercadoPagoWebhookSecret,
      notificationUrl: mercadoPagoNotificationUrl,
    },
    pixChargeTtlSeconds,
    videoProvider,
    panda: {
      apiKey: pandaApiKey,
      signedUrlTtlSeconds: pandaSignedUrlTtlSeconds,
    },
    resend: {
      apiKey: resendApiKey,
      fromEmail: resendFromEmail,
      replyTo: resendReplyTo,
    },
    postHog: {
      apiKey: postHogApiKey,
      host: postHogHost,
    },
    cronSecret,
    appPublicUrl,
    companyName,
    supportEmail,
  };
}
