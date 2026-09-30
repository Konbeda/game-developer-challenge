import { CONTROL_HELP } from '../../game/controls.ts'
import { Table } from '../primitives/index.ts'
import type { TableColumn } from '../primitives/index.ts'

type Row = (typeof CONTROL_HELP)[number]
type Mode = 'both' | 'keyboard' | 'touch'

function Keys({ value }: { value: string }) {
  return (
    <span className="inline-flex flex-nowrap gap-1 whitespace-nowrap">
      {value.split(' / ').map((key) => (
        <kbd
          key={key}
          className="rounded-chip border border-wood bg-board-deep px-1.5 py-px font-sans text-[0.72rem] font-bold text-cream"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

const ACTION: TableColumn<Row> = {
  key: 'action',
  header: 'Action',
  rowHeader: true,
  render: (row) => <span className="text-cream">{row.action}</span>,
}
const KEYBOARD: TableColumn<Row> = {
  key: 'keys',
  header: 'Keyboard',
  render: (row) => <Keys value={row.keys} />,
}
const TOUCH: TableColumn<Row> = {
  key: 'touch',
  header: 'Touch',
  render: (row) => <span className="text-muted">{row.touch}</span>,
}

const COLUMNS: Record<Mode, readonly TableColumn<Row>[]> = {
  both: [ACTION, KEYBOARD, TOUCH],
  keyboard: [ACTION, KEYBOARD],
  touch: [ACTION, TOUCH],
}

/** Control instructions, straight from CONTROL_HELP (the same list the input layer is built from). */
export function ControlsList({
  mode = 'both',
  testId = 'controls-list',
}: {
  mode?: Mode
  testId?: string
}) {
  return (
    <Table
      dense
      caption="Controls"
      columns={COLUMNS[mode]}
      rows={CONTROL_HELP}
      getRowKey={(row) => row.action}
      testId={testId}
    />
  )
}
