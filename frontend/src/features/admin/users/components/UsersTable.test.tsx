import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AdminUserRow, Role } from '../../../../contracts/adminUsers'
import { UsersTable } from './UsersTable'

function row(userId: string, role: Role, isActive = true): AdminUserRow {
  return { userId, email: `${userId}@example.com`, fullName: userId, role, isActive, createdAt: '2026-01-01T00:00:00Z' }
}

const USERS = [row('me', 'admin'), row('stu', 'student'), row('tut', 'tutor', false), row('adm', 'admin'), row('sup', 'superadmin')]

function renderTable(actorRole: Role, handlers = { onChangeRole: vi.fn(), onToggleActive: vi.fn() }) {
  render(<UsersTable users={USERS} actorId="me" actorRole={actorRole} {...handlers} />)
  return handlers
}

function rowOf(id: string) {
  return screen.getByRole('row', { name: new RegExp(`${id}@example.com`) })
}

describe('UsersTable', () => {
  it('shows email, role and status labels', () => {
    renderTable('superadmin')
    const stu = within(rowOf('stu'))
    expect(stu.getByText('Aluno')).toBeInTheDocument()
    expect(stu.getByText('Ativo')).toBeInTheDocument()
    expect(within(rowOf('tut')).getByText('Inativo')).toBeInTheDocument()
  })

  it('shows no actions on the self row', () => {
    renderTable('superadmin')
    expect(within(rowOf('me')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lets an admin act only on student and tutor rows', () => {
    renderTable('admin')
    expect(within(rowOf('stu')).getByRole('button', { name: /^Alterar papel de / })).toBeInTheDocument()
    expect(within(rowOf('tut')).getByRole('button', { name: /^Reativar / })).toBeInTheDocument()
    expect(within(rowOf('adm')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rowOf('sup')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lets a superadmin act on admin and peer superadmin rows', () => {
    renderTable('superadmin')
    expect(within(rowOf('adm')).getByRole('button', { name: /^Alterar papel de / })).toBeInTheDocument()
    expect(within(rowOf('sup')).getByRole('button', { name: /^Desativar / })).toBeInTheDocument()
  })

  it('gives each row button a per-user accessible name', () => {
    renderTable('admin')
    expect(screen.getByRole('button', { name: 'Alterar papel de stu@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desativar stu@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reativar tut@example.com' })).toBeInTheDocument()
  })

  it('wraps user-controlled name and email in <bdi>', () => {
    renderTable('admin')
    expect(screen.getByText('stu@example.com').tagName).toBe('BDI')
    const nameCell = within(rowOf('stu')).getAllByText('stu').find((el) => el.tagName === 'BDI')
    expect(nameCell).toBeDefined()
  })

  it('dims the table, marks it busy and disables row actions while placeholder data is shown', () => {
    render(
      <UsersTable users={USERS} actorId="me" actorRole="admin" isStale onChangeRole={vi.fn()} onToggleActive={vi.fn()} />,
    )
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    for (const button of within(rowOf('stu')).getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('is not busy when data is fresh', () => {
    renderTable('admin')
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy')
  })

  it('marks the table with ph-no-capture', () => {
    renderTable('admin')
    expect(screen.getByRole('table')).toHaveClass('ph-no-capture')
  })

  it('invokes handlers with the row user', async () => {
    const handlers = renderTable('admin')
    const user = userEvent.setup()
    await user.click(within(rowOf('stu')).getByRole('button', { name: /^Alterar papel de / }))
    await user.click(within(rowOf('stu')).getByRole('button', { name: /^Desativar / }))
    expect(handlers.onChangeRole).toHaveBeenCalledWith(USERS[1])
    expect(handlers.onToggleActive).toHaveBeenCalledWith(USERS[1])
  })

  it('shows the empty message when there are no users', () => {
    render(<UsersTable users={[]} actorId="me" actorRole="admin" onChangeRole={vi.fn()} onToggleActive={vi.fn()} />)
    expect(screen.getByText('Nenhum usuário encontrado.')).toBeInTheDocument()
  })
})
