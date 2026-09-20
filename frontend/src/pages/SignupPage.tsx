import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { useAnalytics } from '../features/analytics/useAnalytics'
import { useAuth } from '../features/auth/useAuth'
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from '../lib/validators'

interface FieldErrors {
  readonly email?: string
  readonly password?: string
  readonly confirmPassword?: string
}

export function SignupPage() {
  const { signUp } = useAuth()
  const { capture } = useAnalytics()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Email confirmation is required before the account is usable (the
  // welcome email fires on confirmation, not on signup) — so success here
  // means "check your email", not "you're in".
  const [isAwaitingConfirmation, setIsAwaitingConfirmation] = useState(false)

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    const next: Partial<Record<keyof FieldErrors, string>> = { ...errors }

    if (!isValidEmail(email)) {
      next.email = 'Informe um e-mail válido.'
    }
    if (!isValidPassword(password)) {
      next.password = `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
    }
    if (password !== confirmPassword) {
      next.confirmPassword = 'As senhas não coincidem.'
    }

    return next
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextFieldErrors = validate()
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) {
      return
    }

    capture('signup_started')
    setIsSubmitting(true)
    const { error } = await signUp(email, password)
    setIsSubmitting(false)

    if (error) {
      setFormError(error)
      return
    }

    capture('signup_completed')
    setIsAwaitingConfirmation(true)
  }

  if (isAwaitingConfirmation) {
    return (
      <Card title="Confirme seu e-mail">
        <Alert variant="success">
          Cadastro recebido! Enviamos um link de confirmação para {email}. Confirme seu e-mail
          para ativar sua conta — sua conta ainda não está liberada até essa confirmação.
        </Alert>
      </Card>
    )
  }

  return (
    <Card title="Criar conta">
      <form onSubmit={handleSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <Input
          label="E-mail"
          id="signup-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <Input
          label="Senha"
          id="signup-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          autoComplete="new-password"
        />
        <Input
          label="Confirmar senha"
          id="signup-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldErrors.confirmPassword}
          autoComplete="new-password"
        />
        <Button type="submit" isLoading={isSubmitting}>
          Cadastrar
        </Button>
      </form>
      <p>
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
    </Card>
  )
}
