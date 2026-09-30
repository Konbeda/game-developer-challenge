import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export interface TableColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Cells of this column are row headers (`th scope="row"`). One per table at most. */
  rowHeader?: boolean
  className?: string
}

interface TableProps<T> {
  /** Visible caption (also the accessible name of the table). */
  caption: ReactNode
  columns: readonly TableColumn<T>[]
  rows: readonly T[]
  getRowKey: (row: T) => string
  isHighlighted?: (row: T) => boolean
  /** Dims the body while newer data is being fetched (previous data stays visible). */
  stale?: boolean
  /** Compact rows for reference lists (controls help). */
  dense?: boolean
  testId?: string
  rowTestId?: string
}

/** Semantic data table: caption, `th scope="col"`, optional row headers, highlighted rows. */
export function Table<T>({
  caption,
  columns,
  rows,
  getRowKey,
  isHighlighted,
  stale,
  dense,
  testId,
  rowTestId,
}: TableProps<T>) {
  return (
    <table
      className={cx('skin-table', dense && 'skin-table--dense')}
      data-stale={stale ? 'true' : undefined}
      data-testid={testId}
    >
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={column.className}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={getRowKey(row)}
            data-highlight={isHighlighted?.(row) ? 'true' : undefined}
            data-testid={rowTestId}
          >
            {columns.map((column) =>
              column.rowHeader ? (
                <th
                  key={column.key}
                  scope="row"
                  className={cx('skin-table__rowheader', column.className)}
                >
                  {column.render(row)}
                </th>
              ) : (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
