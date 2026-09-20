import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from './Alert'

describe('Alert', () => {
  it('renders its children', () => {
    render(<Alert>Algo deu errado.</Alert>)
    expect(screen.getByText('Algo deu errado.')).toBeInTheDocument()
  })

  it('defaults to the info variant with an assistive role="status"', () => {
    render(<Alert>Informação</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('Informação')
  })

  it('uses role="alert" (assertive) for the error variant', () => {
    render(<Alert variant="error">Falhou</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou')
  })

  it('uses role="alert" (assertive) for the warning variant', () => {
    render(<Alert variant="warning">Cuidado</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Cuidado')
  })

  it('uses role="status" (polite) for the success variant', () => {
    render(<Alert variant="success">Feito</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('Feito')
  })

  it('applies the variant as a class name', () => {
    render(<Alert variant="error">Falhou</Alert>)
    expect(screen.getByRole('alert').className).toMatch(/error/)
  })
})
