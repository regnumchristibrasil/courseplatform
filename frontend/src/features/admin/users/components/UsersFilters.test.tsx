import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUsersFilters } from '../filters'
import { UsersFilters } from './UsersFilters'

const BASE: AdminUsersFilters = { search: '', role: undefined, active: undefined, page: 1, limit: 20 }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(filters: AdminUsersFilters = BASE) {
  const onChange = vi.fn()
  render(<UsersFilters filters={filters} onChange={onChange} />)
  return onChange
}

function typeSearch(value: string) {
  fireEvent.change(screen.getByLabelText('Buscar'), { target: { value } })
}

describe('UsersFilters', () => {
  it('debounces search by 300ms', () => {
    const onChange = setup()
    typeSearch('an')
    act(() => vi.advanceTimersByTime(299))
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenCalledWith({ search: 'an' })
  })

  it('collapses rapid keystrokes into one call', () => {
    const onChange = setup()
    typeSearch('an')
    act(() => vi.advanceTimersByTime(200))
    typeSearch('ana')
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ search: 'ana' })
  })

  it('does not search with a single character', () => {
    const onChange = setup()
    typeSearch('a')
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits an empty term when backspacing from "abc" down to one character', () => {
    const onChange = setup({ ...BASE, search: 'abc' })
    typeSearch('ab')
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith({ search: 'ab' })
    onChange.mockClear()
    typeSearch('a')
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledWith({ search: '' })
  })

  it('keeps the input in sync when the URL term changes externally (back/forward)', () => {
    const onChange = vi.fn()
    const { rerender } = render(<UsersFilters filters={{ ...BASE, search: 'ana' }} onChange={onChange} />)
    expect(screen.getByLabelText('Buscar')).toHaveValue('ana')
    rerender(<UsersFilters filters={{ ...BASE, search: '' }} onChange={onChange} />)
    expect(screen.getByLabelText('Buscar')).toHaveValue('')
    rerender(<UsersFilters filters={{ ...BASE, search: 'bia' }} onChange={onChange} />)
    expect(screen.getByLabelText('Buscar')).toHaveValue('bia')
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not overwrite what the user keeps typing when its own emitted term comes back', () => {
    const onChange = vi.fn()
    const { rerender } = render(<UsersFilters filters={BASE} onChange={onChange} />)
    typeSearch('an')
    act(() => vi.advanceTimersByTime(300))
    typeSearch('ana')
    rerender(<UsersFilters filters={{ ...BASE, search: 'an' }} onChange={onChange} />)
    expect(screen.getByLabelText('Buscar')).toHaveValue('ana')
  })

  it('clears the search when emptied', () => {
    const onChange = setup({ ...BASE, search: 'ana' })
    expect(screen.getByLabelText('Buscar')).toHaveValue('ana')
    typeSearch('')
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledWith({ search: '' })
  })

  it('emits role patches and clears with Todos', async () => {
    vi.useRealTimers()
    const onChange = setup()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Papel'), 'tutor')
    expect(onChange).toHaveBeenLastCalledWith({ role: 'tutor' })
    await user.selectOptions(screen.getByLabelText('Papel'), '')
    expect(onChange).toHaveBeenLastCalledWith({ role: undefined })
  })

  it('emits status patches', async () => {
    vi.useRealTimers()
    const onChange = setup()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Status'), 'false')
    expect(onChange).toHaveBeenLastCalledWith({ active: false })
    await user.selectOptions(screen.getByLabelText('Status'), 'true')
    expect(onChange).toHaveBeenLastCalledWith({ active: true })
  })

  it('reflects current filters in the controls', () => {
    setup({ ...BASE, role: 'admin', active: true })
    expect(screen.getByLabelText('Papel')).toHaveValue('admin')
    expect(screen.getByLabelText('Status')).toHaveValue('true')
  })
})
