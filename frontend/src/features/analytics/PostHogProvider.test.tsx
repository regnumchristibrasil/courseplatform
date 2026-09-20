import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../lib/env'
import { capturePostHogEvent, initPostHogClient } from './posthogClient'
import { PostHogProvider } from './PostHogProvider'
import { useAnalytics } from './useAnalytics'

vi.mock('./posthogClient', () => ({
  initPostHogClient: vi.fn(),
  capturePostHogEvent: vi.fn(),
}))

const CONSENT_STORAGE_KEY = 'courseplatform_analytics_consent'

function CaptureProbe() {
  const { capture } = useAnalytics()
  return (
    <button type="button" onClick={() => capture('login_completed')}>
      fire-event
    </button>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(initPostHogClient).mockClear()
  vi.mocked(capturePostHogEvent).mockClear()
})

describe('PostHogProvider', () => {
  it('renders its children', () => {
    render(
      <PostHogProvider>
        <p>conteúdo protegido</p>
      </PostHogProvider>,
    )
    expect(screen.getByText('conteúdo protegido')).toBeInTheDocument()
  })

  it('shows the consent banner and does not initialize PostHog when no prior consent is stored', () => {
    render(
      <PostHogProvider>
        <p>app</p>
      </PostHogProvider>,
    )

    expect(screen.getByRole('region', { name: /consentimento/i })).toBeInTheDocument()
    expect(initPostHogClient).not.toHaveBeenCalled()
  })

  it('initializes PostHog with the env-configured key/host once the user accepts', async () => {
    const user = userEvent.setup()
    render(
      <PostHogProvider>
        <p>app</p>
      </PostHogProvider>,
    )

    await user.click(screen.getByRole('button', { name: /aceitar/i }))

    expect(initPostHogClient).toHaveBeenCalledTimes(1)
    expect(initPostHogClient).toHaveBeenCalledWith({
      apiKey: env.posthogKey,
      apiHost: env.posthogHost,
    })
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('granted')
    expect(screen.queryByRole('region', { name: /consentimento/i })).not.toBeInTheDocument()
  })

  it('never initializes PostHog when the user declines, and persists the decision', async () => {
    const user = userEvent.setup()
    render(
      <PostHogProvider>
        <p>app</p>
      </PostHogProvider>,
    )

    await user.click(screen.getByRole('button', { name: /recusar/i }))

    expect(initPostHogClient).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('denied')
    expect(screen.queryByRole('region', { name: /consentimento/i })).not.toBeInTheDocument()
  })

  it('initializes immediately, without showing the banner, when consent was already granted in a prior session', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')

    render(
      <PostHogProvider>
        <p>app</p>
      </PostHogProvider>,
    )

    expect(initPostHogClient).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: /consentimento/i })).not.toBeInTheDocument()
  })

  it('does not show the banner again when consent was already denied in a prior session', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')

    render(
      <PostHogProvider>
        <p>app</p>
      </PostHogProvider>,
    )

    expect(initPostHogClient).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /consentimento/i })).not.toBeInTheDocument()
  })

  it('structurally blocks capture() calls before consent is granted, even if a child calls it immediately', async () => {
    const user = userEvent.setup()
    render(
      <PostHogProvider>
        <CaptureProbe />
      </PostHogProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'fire-event' }))

    expect(capturePostHogEvent).not.toHaveBeenCalled()
  })

  it('allows capture() calls to reach posthog-js once consent has been granted', async () => {
    const user = userEvent.setup()
    render(
      <PostHogProvider>
        <CaptureProbe />
      </PostHogProvider>,
    )

    await user.click(screen.getByRole('button', { name: /aceitar/i }))
    await user.click(screen.getByRole('button', { name: 'fire-event' }))

    expect(capturePostHogEvent).toHaveBeenCalledWith('login_completed', undefined)
  })

  it('never fires a capture call after the user explicitly declines', async () => {
    const user = userEvent.setup()
    render(
      <PostHogProvider>
        <CaptureProbe />
      </PostHogProvider>,
    )

    await user.click(screen.getByRole('button', { name: /recusar/i }))
    await user.click(screen.getByRole('button', { name: 'fire-event' }))

    expect(capturePostHogEvent).not.toHaveBeenCalled()
  })
})
