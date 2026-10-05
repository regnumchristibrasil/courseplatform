import posthog from 'posthog-js'
import { describe, expect, it, vi } from 'vitest'
import { capturePostHogEvent, initPostHogClient } from './posthogClient'
import { sanitizeCaptureResult } from './sanitizeAnalytics'

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}))

describe('initPostHogClient', () => {
  it('initializes the underlying posthog-js client with autocapture and pageview tracking on', () => {
    initPostHogClient({ apiKey: 'phc_test', apiHost: 'https://us.i.posthog.com' })

    expect(posthog.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
        autocapture: true,
        capture_pageview: true,
      }),
    )
  })
})

describe('initPostHogClient privacy', () => {
  it('registers the sanitizer as before_send', () => {
    initPostHogClient({ apiKey: 'phc_test', apiHost: 'https://us.i.posthog.com' })
    expect(posthog.init).toHaveBeenLastCalledWith(
      'phc_test',
      expect.objectContaining({ before_send: sanitizeCaptureResult }),
    )
  })
})

describe('capturePostHogEvent', () => {
  it('delegates to the underlying posthog-js capture call', () => {
    capturePostHogEvent('login_completed', { method: 'password' })

    expect(posthog.capture).toHaveBeenCalledWith('login_completed', { method: 'password' })
  })

  it('delegates without a properties argument when none is given', () => {
    capturePostHogEvent('catalog_viewed')

    expect(posthog.capture).toHaveBeenCalledWith('catalog_viewed', undefined)
  })
})
