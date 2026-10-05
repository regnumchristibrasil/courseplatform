import type { ReactNode } from 'react'
import styles from './Table.module.css'

interface RenderedColumn<T> {
  readonly key: string
  readonly header: string
  readonly render: (row: T) => ReactNode
}

// Sem render, a coluna lê o campo da linha: a chave precisa existir em T.
interface FieldColumn<T> {
  readonly key: keyof T & string
  readonly header: string
  readonly render?: undefined
}

export type TableColumn<T> = RenderedColumn<T> | FieldColumn<T>

export interface TableProps<T> {
  readonly caption: string
  readonly columns: readonly TableColumn<T>[]
  readonly rows: readonly T[]
  readonly getRowKey: (row: T) => string
  readonly emptyMessage?: string
  // Dados provisórios/desatualizados: aria-busy e aparência esmaecida.
  readonly busy?: boolean
  readonly className?: string
}

function cellContent<T>(column: TableColumn<T>, row: T): ReactNode {
  if (column.render) return column.render(row)
  const value: unknown = row[column.key]
  return value === null || value === undefined ? '' : String(value)
}

// Presentational only — rows and cell rendering come from the caller.
export function Table<T>({ caption, columns, rows, getRowKey, emptyMessage, busy = false, className }: TableProps<T>) {
  return (
    <table
      className={[styles.table, busy ? styles.busy : '', className].filter(Boolean).join(' ')}
      aria-busy={busy ? true : undefined}
    >
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={styles.th}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && emptyMessage ? (
          <tr>
            <td colSpan={columns.length} className={styles.empty}>
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={styles.td}>
                  {cellContent(column, row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
