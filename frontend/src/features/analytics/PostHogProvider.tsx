import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { env } from '../../lib/env'
import { AnalyticsContext, type AnalyticsContextValue, type ConsentStatus } from './AnalyticsContext'
import { ConsentBanner } from './ConsentBanner'
import type { ClientEventName } from './eventNames'
import { capturePostHogEvent, initPostHogClient } from './posthogClient'

const CONSENT_STORAGE_KEY = 'courseplatform_analytics_consent'

function readStoredConsent(): ConsentStatus {
  if (typeof window === 'undefined') {
    return 'pending'
  }
  const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY)
  return stored === 'granted' || stored === 'denied' ? stored : 'pending'
}

export interface PostHogProviderProps {
  readonly children: ReactNode
}

// LGPD consent gate. Autocapture (and any capture at all) must stay off
// until consent is explicitly given — enforced structurally here, not just
// by convention:
//   1. `initPostHogClient` (which calls posthog.init, the only thing that
//      makes posthog-js start collecting anything) is only ever called
//      after `consentStatus === 'granted'`.
//   2. `isInitializedRef` only flips to true right after that call
//      succeeds, and `capture()` is a no-op whenever it is false — so even
//      a child component that calls `capture()` immediately on mount,
//      before the user has acted, cannot reach posthog-js.
export function PostHogProvider({ children }: PostHogProviderProps) {
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>(readStoredConsent)
  const isInitializedRef = useRef(false)

  useEffect(() => {
    if (consentStatus === 'granted' && !isInitializedRef.current) {
      initPostHogClient({ apiKey: env.posthogKey, apiHost: env.posthogHost })
      isInitializedRef.current = true
    }
  }, [consentStatus])

  const grantConsent = useCallback(() => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    setConsentStatus('granted')
  }, [])

  const denyConsent = useCallback(() => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    setConsentStatus('denied')
  }, [])

  const capture = useCallback((event: ClientEventName, properties?: Record<string, unknown>) => {
    if (!isInitializedRef.current) {
      return
    }
    capturePostHogEvent(event, properties)
  }, [])

  const value = useMemo<AnalyticsContextValue>(
    () => ({ consentStatus, grantConsent, denyConsent, capture }),
    [consentStatus, grantConsent, denyConsent, capture],
  )

  return (
    <AnalyticsContext.Provider value={value}>
      {consentStatus === 'pending' ? (
        <ConsentBanner onAccept={grantConsent} onDecline={denyConsent} />
      ) : null}
      {children}
    </AnalyticsContext.Provider>
  )
}
