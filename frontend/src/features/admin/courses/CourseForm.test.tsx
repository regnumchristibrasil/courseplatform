import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CourseForm, type CourseFormProps } from './CourseForm'

const INITIAL = { title: 'Curso A', description: 'Desc', priceCents: 19900, accessDurationDays: 30 }

function setup(props: Partial<CourseFormProps> = {}) {
  const onSubmit = vi.fn()
  render(
    <CourseForm
      initial={INITIAL}
      canEditCommercial
      priceRequired={false}
      isSaving={false}
      onSubmit={onSubmit}
      submitLabel="Salvar"
      {...props}
    />,
  )
  return { onSubmit, user: userEvent.setup() }
}

describe('CourseForm', () => {
  it('prefills the fields', () => {
    setup()
    expect(screen.getByLabelText('Título')).toHaveValue('Curso A')
    expect(screen.getByLabelText('Descrição')).toHaveValue('Desc')
    expect(screen.getByLabelText('Preço (R$)')).toHaveValue('199,00')
    expect(screen.getByLabelText('Duração do acesso (dias)')).toHaveValue('30')
  })

  it('submits the contract fields', async () => {
    const { onSubmit, user } = setup()
    await user.clear(screen.getByLabelText('Título'))
    await user.type(screen.getByLabelText('Título'), '  Novo  ')
    await user.clear(screen.getByLabelText('Preço (R$)'))
    await user.type(screen.getByLabelText('Preço (R$)'), '1.250,50')
    await user.clear(screen.getByLabelText('Duração do acesso (dias)'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Novo', description: 'Desc', priceCents: 125050, accessDurationDays: null })
  })

  it('blocks submit and shows field errors mirroring the server rules', async () => {
    const { onSubmit, user } = setup()
    await user.clear(screen.getByLabelText('Título'))
    await user.clear(screen.getByLabelText('Preço (R$)'))
    await user.type(screen.getByLabelText('Preço (R$)'), '0')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Informe o título do curso.')).toBeInTheDocument()
    expect(screen.getByText('O preço deve ser maior que zero.')).toBeInTheDocument()
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true')
  })

  it('requires a price when priceRequired (published course)', async () => {
    const { onSubmit, user } = setup({ priceRequired: true })
    await user.clear(screen.getByLabelText('Preço (R$)'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Informe o preço do curso.')).toBeInTheDocument()
  })

  it('shows price and duration as read-only for a tutor and resends the originals', async () => {
    const { onSubmit, user } = setup({ canEditCommercial: false })
    expect(screen.getByLabelText('Preço (R$)')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Duração do acesso (dias)')).toHaveAttribute('readonly')
    expect(screen.getByText('Somente administradores alteram preço e duração do acesso.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Título'), '!')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Curso A!', description: 'Desc', priceCents: 19900, accessDurationDays: 30 })
  })

  it('warns about pending orders only when the price changes', async () => {
    const { user } = setup({ pendingOrderCount: 2 })
    expect(screen.queryByText(/mantêm o valor antigo/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Preço (R$)'), '5')
    expect(screen.getByText('Há 2 pedidos pendentes. Eles mantêm o valor antigo por até 30 minutos.')).toBeInTheDocument()
  })

  it('does not warn about pending orders when there are none', async () => {
    const { user } = setup({ pendingOrderCount: 0 })
    await user.type(screen.getByLabelText('Preço (R$)'), '5')
    expect(screen.queryByText(/mantêm o valor antigo/)).not.toBeInTheDocument()
  })

  it('warns that a duration change applies only to new purchases', async () => {
    const { user } = setup({ pendingOrderCount: 0 })
    await user.type(screen.getByLabelText('Duração do acesso (dias)'), '0')
    expect(screen.getByText('A nova duração vale apenas para novas compras.')).toBeInTheDocument()
  })

  it('does not show change warnings in create mode (no baseline)', async () => {
    const { user } = setup({ initial: { title: '', description: null, priceCents: null, accessDurationDays: null }, pendingOrderCount: undefined })
    await user.type(screen.getByLabelText('Preço (R$)'), '10')
    await user.type(screen.getByLabelText('Duração do acesso (dias)'), '10')
    expect(screen.queryByText(/apenas para novas compras/)).not.toBeInTheDocument()
  })

  it('shows a save error and disables submit while saving', () => {
    setup({ errorMessage: 'Falhou', isSaving: true })
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
})
