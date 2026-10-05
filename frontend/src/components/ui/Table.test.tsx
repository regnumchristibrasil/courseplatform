import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Table, type TableColumn } from './Table'

interface Row {
  readonly id: string
  readonly name: string
}

const columns: readonly TableColumn<Row>[] = [
  { key: 'name', header: 'Nome' },
  { key: 'custom', header: 'Custom', render: (row) => `<${row.name}>` },
]
const rows: readonly Row[] = [
  { id: '1', name: 'Ana' },
  { id: '2', name: 'Bia' },
]

describe('Table', () => {
  it('renders a caption as the accessible name', () => {
    render(<Table caption="Usuarios" columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    expect(screen.getByRole('table', { name: 'Usuarios' })).toBeInTheDocument()
  })

  it('renders headers inside thead with column scope', () => {
    render(<Table caption="Usuarios" columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    const header = screen.getByRole('columnheader', { name: 'Nome' })
    expect(header).toHaveAttribute('scope', 'col')
    expect(header.closest('thead')).not.toBeNull()
  })

  it('renders one body row per item inside tbody', () => {
    render(<Table caption="Usuarios" columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    const cell = screen.getByRole('cell', { name: 'Ana' })
    expect(cell.closest('tbody')).not.toBeNull()
    expect(within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')).toHaveLength(2)
  })

  it('uses the custom render function when provided', () => {
    render(<Table caption="Usuarios" columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    expect(screen.getByText('<Ana>')).toBeInTheDocument()
  })

  it('renders the empty message when there are no rows', () => {
    render(
      <Table caption="Usuarios" columns={columns} rows={[]} getRowKey={(r) => r.id} emptyMessage="Nada aqui" />,
    )
    expect(screen.getByText('Nada aqui')).toBeInTheDocument()
  })

  it('sets aria-busy only when busy', () => {
    const { rerender } = render(<Table caption="U" columns={columns} rows={rows} getRowKey={(r) => r.id} />)
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy')
    rerender(<Table caption="U" columns={columns} rows={rows} getRowKey={(r) => r.id} busy />)
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
  })

  it('applies a custom className to the table', () => {
    render(<Table caption="U" columns={columns} rows={rows} getRowKey={(r) => r.id} className="ph-no-capture" />)
    expect(screen.getByRole('table')).toHaveClass('ph-no-capture')
  })
})
