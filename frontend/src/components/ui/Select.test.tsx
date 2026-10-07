import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

const options = [
  { value: 'student', label: 'Aluno' },
  { value: 'admin', label: 'Administrador' },
]

describe('Select', () => {
  it('associates the label with a native select', () => {
    render(<Select label="Papel" options={options} defaultValue="student" />)
    const select = screen.getByLabelText('Papel')
    expect(select.tagName).toBe('SELECT')
  })

  it('renders every option', () => {
    render(<Select label="Papel" options={options} />)
    expect(screen.getByRole('option', { name: 'Aluno' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Administrador' })).toBeInTheDocument()
  })

  it('renders a disabled placeholder option when provided', () => {
    render(<Select label="Papel" options={options} placeholder="Selecione" defaultValue="" />)
    expect(screen.getByRole('option', { name: 'Selecione' })).toBeDisabled()
  })

  it('calls onChange when the user picks an option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select label="Papel" options={options} onChange={onChange} defaultValue="student" />)

    await user.selectOptions(screen.getByLabelText('Papel'), 'admin')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Papel')).toHaveValue('admin')
  })

  it('shows the error and links it via aria-describedby', () => {
    render(<Select label="Papel" options={options} error="Obrigatorio" />)
    const select = screen.getByLabelText('Papel')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Obrigatorio')
    expect(select).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
  })

  it('honors an explicit id', () => {
    render(<Select label="Papel" id="role" options={options} />)
    expect(screen.getByLabelText('Papel')).toHaveAttribute('id', 'role')
  })
})
