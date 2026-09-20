import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsContext, type AnalyticsContextValue } from '../features/analytics/AnalyticsContext'
import { AuthContext, type AuthContextValue } from '../features/auth/AuthContext'
import { LoginPage } from './LoginPage'

function buildAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    user: null,
    isLoading: false,
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  }
}

function buildAnalyticsValue(overrides: Partial<AnalyticsContextValue> = {}): AnalyticsContextValue {
  return {
    consentStatus: 'pending',
    grantConsent: vi.fn(),
    denyConsent: vi.fn(),
    capture: vi.fn(),
    ...overrides,
  }
}

function renderLogin({
  authValue = buildAuthValue(),
  analyticsValue = buildAnalyticsValue(),
  initialEntries = ['/login'],
}: {
  authValue?: AuthContextValue
  analyticsValue?: AnalyticsContextValue
  initialEntries?: readonly string[]
} = {}) {
  return render(
    <AnalyticsContext.Provider value={analyticsValue}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={initialEntries as string[]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>Home page</p>} />
            <Route path="/my-courses" element={<p>My courses page</p>} />
            <Route path="/signup" element={<p>Signup page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </AnalyticsContext.Provider>,
  )
}

describe('LoginPage', () => {
  it('renders email and password fields plus a submit button', () => {
    renderLogin()

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })

  it('shows validation errors and does not call signIn when the form is empty', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue()
    renderLogin({ authValue })

    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
    expect(authValue.signIn).not.toHaveBeenCalled()
  })

  it('rejects a malformed email without calling signIn', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue()
    renderLogin({ authValue })

    await user.type(screen.getByLabelText(/e-mail/i), 'not-an-email')
    await user.type(screen.getByLabelText(/senha/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(authValue.signIn).not.toHaveBeenCalled()
  })

  it('signs in, fires login_completed, and navigates home on success', async () => {
    const user = userEvent.setup()
    const capture = vi.fn()
    const authValue = buildAuthValue({ signIn: vi.fn().mockResolvedValue({ error: null }) })
    renderLogin({ authValue, analyticsValue: buildAnalyticsValue({ capture }) })

    await user.type(screen.getByLabelText(/e-mail/i), 'user@example.com')
    await user.type(screen.getByLabelText(/senha/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(authValue.signIn).toHaveBeenCalledWith('user@example.com', 'secret123')
    expect(capture).toHaveBeenCalledWith('login_completed')
  })

  it('redirects back to the originally requested page after login', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue({ signIn: vi.fn().mockResolvedValue({ error: null }) })

    render(
      <AnalyticsContext.Provider value={buildAnalyticsValue()}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter
            initialEntries={[{ pathname: '/login', state: { from: { pathname: '/my-courses' } } }]}
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/my-courses" element={<p>My courses page</p>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </AnalyticsContext.Provider>,
    )

    await user.type(screen.getByLabelText(/e-mail/i), 'user@example.com')
    await user.type(screen.getByLabelText(/senha/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByText('My courses page')).toBeInTheDocument()
  })

  it('shows a friendly error message and does not navigate when signIn fails', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue({
      signIn: vi.fn().mockResolvedValue({ error: 'E-mail ou senha inválidos.' }),
    })
    renderLogin({ authValue })

    await user.type(screen.getByLabelText(/e-mail/i), 'user@example.com')
    await user.type(screen.getByLabelText(/senha/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByText('E-mail ou senha inválidos.')).toBeInTheDocument()
    expect(screen.queryByText('Home page')).not.toBeInTheDocument()
  })

  it('links to the signup page', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: /cadastr/i })).toHaveAttribute('href', '/signup')
  })
})
