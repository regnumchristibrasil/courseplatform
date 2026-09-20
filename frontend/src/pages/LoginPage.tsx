import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAnalytics } from '../features/analytics/useAnalytics'
import { useAuth } from '../features/auth/useAuth'
import { isValidEmail } from '../lib/validators'

interface FieldErrors {
  readonly email?: string
  readonly password?: string
}

interface RedirectLocationState {
  readonly from?: { readonly pathname: string }
}

export function LoginPage() {
  const { signIn } = useAuth()
  const { capture } = useAnalytics()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (!isValidEmail(email)) {
      return { ...errors, email: 'Informe um e-mail válido.' }
    }
    return errors
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextFieldErrors: FieldErrors = {
      ...validate(),
      ...(password.length === 0 ? { password: 'Informe sua senha.' } : {}),
    }
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) {
      return
    }

    setIsSubmitting(true)
    const { error } = await signIn(email, password)
    setIsSubmitting(false)

    if (error) {
      setFormError(error)
      return
    }

    capture('login_completed')
    const state = location.state as RedirectLocationState | null
    navigate(state?.from?.pathname ?? '/', { replace: true })
  }

  return (
    <Card title="Entrar">
      <form onSubmit={handleSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <Input
          label="E-mail"
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <Input
          label="Senha"
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          autoComplete="current-password"
        />
        <Button type="submit" isLoading={isSubmitting}>
          Entrar
        </Button>
      </form>
      <p>
        Não tem conta? <Link to="/signup">Cadastre-se</Link>
      </p>
    </Card>
  )
}
