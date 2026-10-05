import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, parseFilters, toListRequest, toSearchParams } from './filters'

const params = (s: string) => new URLSearchParams(s)

describe('parseFilters', () => {
  it('returns defaults for empty params', () => {
    expect(parseFilters(params(''))).toEqual({ search: '', role: undefined, active: undefined, page: 1, limit: DEFAULT_PAGE_SIZE })
  })

  it('reads valid values', () => {
    expect(parseFilters(params('q=ana&role=tutor&active=false&page=3&limit=10'))).toEqual({
      search: 'ana', role: 'tutor', active: false, page: 3, limit: 10,
    })
  })

  it('drops invalid role and active values', () => {
    const f = parseFilters(params('role=root&active=maybe'))
    expect(f.role).toBeUndefined()
    expect(f.active).toBeUndefined()
  })

  it.each([['limit=999', 50], ['limit=0', 20], ['limit=-5', 20], ['limit=abc', 20], ['limit=1.5', 20]])(
    'clamps %s to %i',
    (qs, expected) => {
      expect(parseFilters(params(qs)).limit).toBe(expected)
    },
  )

  it.each(['page=0', 'page=-2', 'page=x', 'page=2.5'])('falls back to page 1 for %s', (qs) => {
    expect(parseFilters(params(qs)).page).toBe(1)
  })

  it.each([['page=10000', 10000], ['page=10001', 1], ['page=99999999', 1]])(
    'caps %s to %i (out of cap falls back to page 1)',
    (qs, expected) => {
      expect(parseFilters(params(qs)).page).toBe(expected)
    },
  )

  it('drops a search shorter than the minimum length', () => {
    expect(parseFilters(params('q=a')).search).toBe('')
    expect(parseFilters(params('q=%20a%20')).search).toBe('')
    expect(parseFilters(params('q=ab')).search).toBe('ab')
  })

  it('truncates a search longer than 100 characters', () => {
    expect(parseFilters(params(`q=${'x'.repeat(250)}`)).search).toHaveLength(100)
  })

  it('trims search', () => {
    expect(parseFilters(params('q=%20%20ana%20')).search).toBe('ana')
  })
})

describe('toSearchParams', () => {
  it('omits defaults', () => {
    expect(toSearchParams(parseFilters(params(''))).toString()).toBe('')
  })

  it('round-trips non-default filters', () => {
    const filters = { search: 'ana', role: 'admin' as const, active: true, page: 2, limit: 10 }
    expect(parseFilters(toSearchParams(filters))).toEqual(filters)
  })
})

describe('toListRequest', () => {
  it('computes offset from page and limit', () => {
    const req = toListRequest({ search: 'a', role: 'tutor', active: false, page: 3, limit: 20 })
    expect(req).toEqual({ search: 'a', role: 'tutor', active: false, limit: 20, offset: 40 })
  })

  it('omits empty search', () => {
    expect(toListRequest(parseFilters(params(''))).search).toBeUndefined()
  })
})
