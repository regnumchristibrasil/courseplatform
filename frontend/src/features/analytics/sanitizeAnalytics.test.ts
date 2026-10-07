import { describe, expect, it } from 'vitest'
import { sanitizeCaptureResult, sanitizeUrl } from './sanitizeAnalytics'

const ORIGIN = 'https://app.example.com'

describe('sanitizeUrl', () => {
  it('strips the q param on /admin routes and keeps the other params', () => {
    expect(sanitizeUrl(`${ORIGIN}/admin/users?q=ana%40example.com&role=tutor&page=2`)).toBe(
      `${ORIGIN}/admin/users?role=tutor&page=2`,
    )
  })

  it('removes the question mark when q was the only param', () => {
    expect(sanitizeUrl(`${ORIGIN}/admin/users?q=ana`)).toBe(`${ORIGIN}/admin/users`)
  })

  it('leaves non-admin urls untouched', () => {
    expect(sanitizeUrl(`${ORIGIN}/catalog?q=react`)).toBe(`${ORIGIN}/catalog?q=react`)
  })

  it('does not treat /administrator as an admin route', () => {
    expect(sanitizeUrl(`${ORIGIN}/administrator?q=x`)).toBe(`${ORIGIN}/administrator?q=x`)
  })

  it('returns an unparseable value unchanged', () => {
    expect(sanitizeUrl('not a url')).toBe('not a url')
  })

  it('handles relative paths', () => {
    expect(sanitizeUrl('/admin/users?q=ana&page=2')).toBe('/admin/users?page=2')
  })
})

describe('sanitizeCaptureResult', () => {
  it('sanitizes $current_url and $referrer on admin events', () => {
    const result = sanitizeCaptureResult({
      event: '$pageview',
      properties: {
        $current_url: `${ORIGIN}/admin/users?q=ana`,
        $referrer: `${ORIGIN}/admin/users?q=bob`,
        $pathname: '/admin/users',
      },
    })
    expect(result?.properties).toEqual({
      $current_url: `${ORIGIN}/admin/users`,
      $referrer: `${ORIGIN}/admin/users`,
      $pathname: '/admin/users',
    })
  })

  it('drops element text from autocaptured elements on admin routes', () => {
    const result = sanitizeCaptureResult({
      event: '$autocapture',
      properties: {
        $current_url: `${ORIGIN}/admin/users`,
        $elements: [{ tag_name: 'button', $el_text: 'Desativar ana@example.com' }],
      },
    })
    expect(result?.properties?.$elements).toEqual([{ tag_name: 'button' }])
  })

  it('does not mutate its input', () => {
    const input = { event: 'e', properties: { $current_url: `${ORIGIN}/admin/users?q=ana` } }
    sanitizeCaptureResult(input)
    expect(input.properties.$current_url).toBe(`${ORIGIN}/admin/users?q=ana`)
  })

  it('leaves non-admin events as they are', () => {
    const input = { event: 'e', properties: { $current_url: `${ORIGIN}/?q=x`, $elements: [{ $el_text: 'Entrar' }] } }
    expect(sanitizeCaptureResult(input)).toEqual(input)
  })

  it('passes through null and results without properties', () => {
    expect(sanitizeCaptureResult(null)).toBeNull()
    expect(sanitizeCaptureResult({ event: 'e' })).toEqual({ event: 'e' })
  })
})
