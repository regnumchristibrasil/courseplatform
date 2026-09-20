import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsContext, type AnalyticsContextValue } from '../features/analytics/AnalyticsContext'
import { useCourses } from '../features/courses/useCourses'
import type { CoursePublic } from '../features/courses/types'
import { CatalogPage } from './CatalogPage'

vi.mock('../features/courses/useCourses', () => ({
  useCourses: vi.fn(),
}))

function buildAnalyticsValue(overrides: Partial<AnalyticsContextValue> = {}): AnalyticsContextValue {
  return {
    consentStatus: 'pending',
    grantConsent: vi.fn(),
    denyConsent: vi.fn(),
    capture: vi.fn(),
    ...overrides,
  }
}

function renderCatalog(analyticsValue = buildAnalyticsValue()) {
  return render(
    <AnalyticsContext.Provider value={analyticsValue}>
      <CatalogPage />
    </AnalyticsContext.Provider>,
  )
}

const SAMPLE_COURSES: readonly CoursePublic[] = [
  {
    id: 'course-1',
    title: 'Introdução ao React',
    description: 'Fundamentos de React na prática.',
    price_cents: 19900,
    access_duration_days: null,
  },
  {
    id: 'course-2',
    title: 'TypeScript avançado',
    description: 'Tipos avançados e padrões.',
    price_cents: 29900,
    access_duration_days: 30,
  },
]

function mockUseCourses(overrides: Partial<ReturnType<typeof useCourses>>) {
  vi.mocked(useCourses).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useCourses>)
}

describe('CatalogPage', () => {
  it('shows a loading indicator while the catalog is loading', () => {
    mockUseCourses({ isLoading: true })

    renderCatalog()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders each course with title, description, price and access duration once loaded', () => {
    mockUseCourses({ data: SAMPLE_COURSES })

    renderCatalog()

    expect(screen.getByRole('heading', { name: 'Introdução ao React' })).toBeInTheDocument()
    expect(screen.getByText('Fundamentos de React na prática.')).toBeInTheDocument()
    expect(screen.getByText('R$ 199,00')).toBeInTheDocument()
    expect(screen.getByText('Acesso vitalício')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'TypeScript avançado' })).toBeInTheDocument()
    expect(screen.getByText('R$ 299,00')).toBeInTheDocument()
    expect(screen.getByText('Acesso por 30 dias')).toBeInTheDocument()
  })

  it('shows an empty state when there are no published courses', () => {
    mockUseCourses({ data: [] })

    renderCatalog()

    expect(screen.getByText(/nenhum curso/i)).toBeInTheDocument()
  })

  it('shows an error alert with a retry action when loading fails', async () => {
    const refetch = vi.fn()
    mockUseCourses({ isError: true, error: new Error('falhou'), refetch })

    renderCatalog()

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument()
  })

  it('fires catalog_viewed exactly once on mount', () => {
    mockUseCourses({ data: SAMPLE_COURSES })
    const capture = vi.fn()

    renderCatalog(buildAnalyticsValue({ capture }))

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('catalog_viewed')
  })
})
