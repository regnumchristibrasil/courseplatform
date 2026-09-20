import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsContext, type AnalyticsContextValue } from './AnalyticsContext'
import { useAnalytics } from './useAnalytics'

function buildContextValue(overrides: Partial<AnalyticsContextValue> = {}): AnalyticsContextValue {
  return {
    consentStatus: 'granted',
    grantConsent: vi.fn(),
    denyConsent: vi.fn(),
    capture: vi.fn(),
    ...overrides,
  }
}

describe('useAnalytics', () => {
  it('throws a descriptive error when used outside an AnalyticsContext provider', () => {
    const { result } = renderHook(() => {
      try {
        return useAnalytics()
      } catch (error) {
        return error
      }
    })

    expect(result.current).toBeInstanceOf(Error)
    expect((result.current as Error).message).toMatch(/AnalyticsContext|PostHogProvider/)
  })

  it('returns the provided context value', () => {
    const value = buildContextValue()
    const { result } = renderHook(() => useAnalytics(), {
      wrapper: ({ children }) => (
        <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>
      ),
    })

    expect(result.current).toBe(value)
  })
})
