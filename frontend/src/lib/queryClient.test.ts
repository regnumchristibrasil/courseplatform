import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createQueryClient, queryClient } from './queryClient'

describe('createQueryClient', () => {
  it('returns a QueryClient instance', () => {
    expect(createQueryClient()).toBeInstanceOf(QueryClient)
  })

  it('disables refetch-on-window-focus so background tab churn does not spam PostgREST', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })

  it('retries failed queries a bounded number of times', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().queries?.retry).toBe(1)
  })

  it('builds a fresh, independent instance on every call', () => {
    const a = createQueryClient()
    const b = createQueryClient()
    expect(a).not.toBe(b)
  })
})

describe('queryClient singleton', () => {
  it('is a ready-to-use QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })
})
