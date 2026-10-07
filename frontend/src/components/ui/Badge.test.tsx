import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Ativo</Badge>)
    expect(screen.getByText('Ativo')).toBeInTheDocument()
  })

  it('defaults to the neutral variant', () => {
    render(<Badge>Padrao</Badge>)
    expect(screen.getByText('Padrao').className).toMatch(/neutral/)
  })

  it.each(['success', 'warning', 'danger', 'info'] as const)('applies the %s variant', (variant) => {
    render(<Badge variant={variant}>x</Badge>)
    expect(screen.getByText('x').className).toMatch(new RegExp(variant))
  })
})
