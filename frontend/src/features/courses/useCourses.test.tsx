import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fetchPublishedCourses } from './coursesApi'
import type { CoursePublic } from './types'
import { useCourses } from './useCourses'

vi.mock('./coursesApi', () => ({
  fetchPublishedCourses: vi.fn(),
}))

const SAMPLE_COURSES: readonly CoursePublic[] = [
  {
    id: 'course-1',
    title: 'Introdução ao React',
    description: 'Fundamentos de React na prática.',
    price_cents: 19900,
    access_duration_days: null,
  },
]

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useCourses', () => {
  it('exposes the fetched courses once loaded', async () => {
    vi.mocked(fetchPublishedCourses).mockResolvedValue(SAMPLE_COURSES)

    const { result } = renderHook(() => useCourses(), { wrapper: buildWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(SAMPLE_COURSES)
  })

  it('surfaces an error state when the fetch rejects', async () => {
    vi.mocked(fetchPublishedCourses).mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useCourses(), { wrapper: buildWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})
