import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsContext, type AnalyticsContextValue } from '../features/analytics/AnalyticsContext'
import { AuthContext, type AuthContextValue } from '../features/auth/AuthContext'
import { SignupPage } from './SignupPage'

function buildAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    user: null,
    isLoading: false,
    signIn: vi.fn(),
    signUp: vi.fn().mockResolvedValue({ error: null }),
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

function renderSignup({
  authValue = buildAuthValue(),
  analyticsValue = buildAnalyticsValue(),
}: {
  authValue?: AuthContextValue
  analyticsValue?: AnalyticsContextValue
} = {}) {
  return render(
    <AnalyticsContext.Provider value={analyticsValue}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={['/signup']}>
          <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/login" element={<p>Login page</p>} />
            <Route path="/" element={<p>Home page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </AnalyticsContext.Provider>,
  )
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/e-mail/i), 'new-user@example.com')
  await user.type(screen.getByLabelText('Senha'), 'secret123')
  await user.type(screen.getByLabelText(/confirmar senha/i), 'secret123')
}

describe('SignupPage', () => {
  it('renders email, password and confirm-password fields', () => {
    renderSignup()

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.getByLabelText(/confirmar senha/i)).toBeInTheDocument()
  })

  it('shows a validation error and does not call signUp when passwords do not match', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue()
    renderSignup({ authValue })

    await user.type(screen.getByLabelText(/e-mail/i), 'new-user@example.com')
    await user.type(screen.getByLabelText('Senha'), 'secret123')
    await user.type(screen.getByLabelText(/confirmar senha/i), 'different123')
    await user.click(screen.getByRole('button', { name: /cadastrar/i }))

    expect(await screen.findByText(/senhas não coincidem/i)).toBeInTheDocument()
    expect(authValue.signUp).not.toHaveBeenCalled()
  })

  it('shows a validation error when the password is too short', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue()
    renderSignup({ authValue })

    await user.type(screen.getByLabelText(/e-mail/i), 'new-user@example.com')
    await user.type(screen.getByLabelText('Senha'), 'ab')
    await user.type(screen.getByLabelText(/confirmar senha/i), 'ab')
    await user.click(screen.getByRole('button', { name: /cadastrar/i }))

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
    expect(authValue.signUp).not.toHaveBeenCalled()
  })

  it('calls signUp, fires signup_started then signup_completed, and shows a check-your-email message instead of navigating in', async () => {
    const user = userEvent.setup()
    const capture = vi.fn()
    const authValue = buildAuthValue({ signUp: vi.fn().mockResolvedValue({ error: null }) })
    renderSignup({ authValue, analyticsValue: buildAnalyticsValue({ capture }) })

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /cadastrar/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/confirme seu e-mail/i)
    expect(authValue.signUp).toHaveBeenCalledWith('new-user@example.com', 'secret123')
    expect(capture).toHaveBeenNthCalledWith(1, 'signup_started')
    expect(capture).toHaveBeenNthCalledWith(2, 'signup_completed')
    expect(screen.queryByText('Home page')).not.toBeInTheDocument()
  })

  it('does not imply immediate account access in its success copy', async () => {
    const user = userEvent.setup()
    const authValue = buildAuthValue({ signUp: vi.fn().mockResolvedValue({ error: null }) })
    renderSignup({ authValue })

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /cadastrar/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/confirme seu e-mail/i)
    expect(screen.queryByRole('button', { name: /cadastrar/i })).not.toBeInTheDocument()
  })

  it('shows a friendly error message when signUp fails and does not fire signup_completed', async () => {
    const user = userEvent.setup()
    const capture = vi.fn()
    const authValue = buildAuthValue({
      signUp: vi.fn().mockResolvedValue({ error: 'Este e-mail já está cadastrado.' }),
    })
    renderSignup({ authValue, analyticsValue: buildAnalyticsValue({ capture }) })

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /cadastrar/i }))

    expect(await screen.findByText('Este e-mail já está cadastrado.')).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('signup_started')
    expect(capture).not.toHaveBeenCalledWith('signup_completed')
  })

  it('links to the login page', () => {
    renderSignup()
    expect(screen.getByRole('link', { name: /entrar/i })).toHaveAttribute('href', '/login')
  })
})
