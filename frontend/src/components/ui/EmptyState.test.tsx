import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nenhum curso disponível" />)
    expect(screen.getByText('Nenhum curso disponível')).toBeInTheDocument()
  })

  it('renders an optional description', () => {
    render(<EmptyState title="Vazio" description="Volte em breve." />)
    expect(screen.getByText('Volte em breve.')).toBeInTheDocument()
  })

  it('renders no description when none is given', () => {
    render(<EmptyState title="Vazio" />)
    expect(screen.queryByText('Volte em breve.')).not.toBeInTheDocument()
  })

  it('renders an optional action', () => {
    render(<EmptyState title="Vazio" action={<button type="button">Recarregar</button>} />)
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
  })
})
