import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Conteúdo</Card>)
    expect(screen.getByText('Conteúdo')).toBeInTheDocument()
  })

  it('renders an optional title as a heading', () => {
    render(<Card title="Curso de React">Conteúdo</Card>)
    expect(screen.getByRole('heading', { name: 'Curso de React' })).toBeInTheDocument()
  })

  it('renders no heading when no title is given', () => {
    render(<Card>Conteúdo</Card>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders an optional footer', () => {
    render(<Card footer={<span>Rodapé</span>}>Conteúdo</Card>)
    expect(screen.getByText('Rodapé')).toBeInTheDocument()
  })
})
