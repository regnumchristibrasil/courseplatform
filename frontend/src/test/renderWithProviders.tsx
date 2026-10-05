import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { Session, User } from '@supabase/supabase-js'
import type { ReactElement } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../features/auth/AuthContext'

export const ACTOR_ID = 'actor-1'

export function buildUser(id: string = ACTOR_ID, email = 'actor@example.com'): User {
  return {
    id,
    email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

export function buildSession(user: User = buildUser()): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }
}

export function buildAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = buildUser()
  return {
    session: buildSession(user),
    user,
    isLoading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  }
}

export interface RenderOptions {
  readonly route?: string
  readonly auth?: Partial<AuthContextValue>
}

export function renderWithProviders(ui: ReactElement, { route = '/', auth = {} }: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const authValue = buildAuth(auth)
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [route] })
  const result = render(
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
  return { ...result, queryClient, invalidate, router, auth: authValue }
}
