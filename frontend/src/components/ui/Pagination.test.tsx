import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from './Pagination'

describe('Pagination', () => {
  it('renders a labelled navigation landmark', () => {
    render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />)
    expect(screen.getByRole('navigation', { name: 'Paginação' })).toBeInTheDocument()
  })

  it('marks only the current page with aria-current', () => {
    render(<Pagination page={2} totalPages={3} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Página 1' })).not.toHaveAttribute('aria-current')
  })

  it('disables previous on the first page', () => {
    render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled()
  })

  it('disables next on the last page', () => {
    render(<Pagination page={3} totalPages={3} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled()
  })

  it('calls onPageChange with the adjacent pages', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<Pagination page={2} totalPages={3} onPageChange={onPageChange} />)

    await user.click(screen.getByRole('button', { name: 'Anterior' }))
    await user.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(onPageChange).toHaveBeenNthCalledWith(1, 1)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3)
  })

  it('calls onPageChange when a page number is clicked', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<Pagination page={1} totalPages={3} onPageChange={onPageChange} />)

    await user.click(screen.getByRole('button', { name: 'Página 3' }))

    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('limits visible page buttons around the current page', () => {
    render(<Pagination page={10} totalPages={20} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Página 10' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página 20' })).not.toBeInTheDocument()
  })

  it('renders nothing when there is a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onPageChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not crash when the current page is beyond the last page', () => {
    render(<Pagination page={100} totalPages={5} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Página 5' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página 100' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled()
  })

  it('goes back to the last page from an out-of-range page', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<Pagination page={100} totalPages={5} onPageChange={onPageChange} />)
    await user.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(onPageChange).toHaveBeenCalledWith(5)
  })
})
