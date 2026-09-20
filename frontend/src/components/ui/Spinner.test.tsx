import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  it('exposes role="status" for assistive tech', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('uses a sensible default accessible label', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Carregando...')
  })

  it('accepts a custom label', () => {
    render(<Spinner label="Carregando cursos..." />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Carregando cursos...')
  })
})
