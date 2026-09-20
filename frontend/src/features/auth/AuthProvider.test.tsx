import { render, renderHook, screen, waitFor } from '@testing-library/react'
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

type AuthStateChangeCallback = (event: AuthChangeEvent, session: Session | null) => void

function buildFakeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  } as Session
}

function buildFakeSupabaseClient(options: {
  readonly initialSession?: Session | null
  readonly getSessionError?: { message: string }
} = {}) {
  const { initialSession = null, getSessionError = null } = options
  const unsubscribe = vi.fn()
  let capturedCallback: AuthStateChangeCallback | null = null

  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: initialSession },
        error: getSessionError,
      }),
      onAuthStateChange: vi.fn((callback: AuthStateChangeCallback) => {
        capturedCallback = callback
        return { data: { subscription: { unsubscribe } } }
      }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  } as unknown as SupabaseClient

  return {
    client,
    unsubscribe,
    emitAuthStateChange: (event: AuthChangeEvent, session: Session | null) => {
      capturedCallback?.(event, session)
    },
  }
}

function AuthProbe() {
  const { session, user, isLoading } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="session">{session ? 'has-session' : 'no-session'}</span>
      <span data-testid="user-id">{user?.id ?? 'no-user'}</span>
    </div>
  )
}

function renderUseAuth(client: SupabaseClient) {
  return renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider client={client}>{children}</AuthProvider>
    ),
  })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AuthProvider', () => {
  it('starts in a loading state and resolves to an unauthenticated state when there is no session', async () => {
    const { client } = buildFakeSupabaseClient({ initialSession: null })

    render(
      <AuthProvider client={client}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('session')).toHaveTextContent('no-session')
    expect(screen.getByTestId('user-id')).toHaveTextContent('no-user')
  })

  it('resolves to an authenticated state when a session already exists', async () => {
    const session = buildFakeSession()
    const { client } = buildFakeSupabaseClient({ initialSession: session })

    render(
      <AuthProvider client={client}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('has-session'))
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-1')
  })

  it('updates context state when the auth state change listener fires', async () => {
    const { client, emitAuthStateChange } = buildFakeSupabaseClient({ initialSession: null })

    render(
      <AuthProvider client={client}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    const session = buildFakeSession({ user: { ...buildFakeSession().user, id: 'user-2' } })
    emitAuthStateChange('SIGNED_IN', session)

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('has-session'))
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-2')
  })

  it('logs (never swallows) a getSession error and still settles into a safe unauthenticated state', async () => {
    const { client } = buildFakeSupabaseClient({ getSessionError: { message: 'network down' } })

    render(
      <AuthProvider client={client}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('session')).toHaveTextContent('no-session')
    expect(console.error).toHaveBeenCalled()
  })

  it('unsubscribes from the auth state listener on unmount', async () => {
    const { client, unsubscribe } = buildFakeSupabaseClient()

    const { unmount } = render(
      <AuthProvider client={client}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('signIn trims the email and forwards it with the password, returning no error on success', async () => {
    const { client } = buildFakeSupabaseClient()
    vi.mocked(client.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as never)

    const { result } = renderUseAuth(client)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const signInResult = await result.current.signIn('  user@example.com  ', 'secret123')

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret123',
    })
    expect(signInResult).toEqual({ error: null })
  })

  it('signIn returns a friendly error message on failure', async () => {
    const { client } = buildFakeSupabaseClient()
    vi.mocked(client.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    } as never)

    const { result } = renderUseAuth(client)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const signInResult = await result.current.signIn('user@example.com', 'wrong')

    expect(signInResult.error).toBe('E-mail ou senha inválidos.')
  })

  it('signUp forwards trimmed email/password and returns no error on success', async () => {
    const { client } = buildFakeSupabaseClient()
    vi.mocked(client.auth.signUp).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as never)

    const { result } = renderUseAuth(client)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const signUpResult = await result.current.signUp('new@example.com', 'secret123')

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'secret123',
    })
    expect(signUpResult).toEqual({ error: null })
  })

  it('signOut returns no error on success and a friendly message on failure', async () => {
    const { client } = buildFakeSupabaseClient()
    vi.mocked(client.auth.signOut).mockResolvedValueOnce({ error: null } as never)

    const { result } = renderUseAuth(client)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const successResult = await result.current.signOut()
    expect(successResult).toEqual({ error: null })

    vi.mocked(client.auth.signOut).mockResolvedValueOnce({
      error: { message: 'boom' },
    } as never)
    const failureResult = await result.current.signOut()
    expect(failureResult.error).toBe('Ocorreu um erro inesperado. Tente novamente.')
  })
})
