import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../features/auth/AuthContext'
import { COMPANY_NAME } from '../config/brand'
import { Layout } from './Layout'

function buildAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    user: null,
    isLoading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  }
}

function renderLayout(authValue: AuthContextValue) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<p>Nested route content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('Layout', () => {
  it('renders the brand name', () => {
    renderLayout(buildAuthValue())
    expect(screen.getByText(COMPANY_NAME)).toBeInTheDocument()
  })

  it('renders the nested route content via Outlet', () => {
    renderLayout(buildAuthValue())
    expect(screen.getByText('Nested route content')).toBeInTheDocument()
  })

  it('shows login/signup links when unauthenticated', () => {
    renderLayout(buildAuthValue({ session: null }))

    expect(screen.getByRole('link', { name: /entrar/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cadastr/i })).toBeInTheDocument()
  })

  it('shows the user email and a sign-out action when authenticated', () => {
    const user = { id: 'user-1', email: 'user@example.com' } as unknown as User
    renderLayout(buildAuthValue({ session: { user } as never, user }))

    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sair/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /entrar/i })).not.toBeInTheDocument()
  })

  it('calls signOut when the sign-out button is clicked', async () => {
    const userInteraction = userEvent.setup()
    const authUser = { id: 'user-1', email: 'user@example.com' } as unknown as User
    const authValue = buildAuthValue({ session: { user: authUser } as never, user: authUser })
    renderLayout(authValue)

    await userInteraction.click(screen.getByRole('button', { name: /sair/i }))

    expect(authValue.signOut).toHaveBeenCalledTimes(1)
  })
})
