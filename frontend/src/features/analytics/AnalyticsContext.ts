import { createContext } from 'react'
import type { ClientEventName } from './eventNames'

export type ConsentStatus = 'pending' | 'granted' | 'denied'

export interface AnalyticsContextValue {
  readonly consentStatus: ConsentStatus
  readonly grantConsent: () => void
  readonly denyConsent: () => void
  // Structurally safe to call regardless of consent state — the provider
  // guarantees this is a no-op until consent has been granted.
  readonly capture: (event: ClientEventName, properties?: Record<string, unknown>) => void
}

export const AnalyticsContext = createContext<AnalyticsContextValue | undefined>(undefined)
