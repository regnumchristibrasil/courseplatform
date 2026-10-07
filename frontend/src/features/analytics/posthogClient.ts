import posthog from 'posthog-js'
import { sanitizeCaptureResult } from './sanitizeAnalytics'

export interface PostHogInitConfig {
  readonly apiKey: string
  readonly apiHost: string
}

// Thin wrapper around posthog-js so the rest of the app never imports the
// library directly — keeps the "who is allowed to call init/capture" rule
// enforceable in one place (see PostHogProvider's consent gate).
export function initPostHogClient({ apiKey, apiHost }: PostHogInitConfig): void {
  posthog.init(apiKey, {
    api_host: apiHost,
    autocapture: true,
    capture_pageview: true,
    // Remove ?q= (e-mail/nome) e texto de elementos nas rotas /admin/*.
    before_send: sanitizeCaptureResult,
  })
}

export function capturePostHogEvent(event: string, properties?: Record<string, unknown>): void {
  posthog.capture(event, properties)
}
