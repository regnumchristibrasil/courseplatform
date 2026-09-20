import { useContext } from 'react'
import { AnalyticsContext, type AnalyticsContextValue } from './AnalyticsContext'

export function useAnalytics(): AnalyticsContextValue {
  const context = useContext(AnalyticsContext)
  if (!context) {
    throw new Error('useAnalytics must be used within a PostHogProvider (AnalyticsContext).')
  }
  return context
}
