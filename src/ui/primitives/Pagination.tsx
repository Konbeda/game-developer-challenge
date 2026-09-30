import { IconButton } from './IconButton.tsx'
import { Spinner } from './Feedback.tsx'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  /** Accessible name of the navigation landmark, e.g. "Ranking pages". */
  label: string
  /** True while a page is being fetched (non-blocking indicator). */
  busy?: boolean
  testIdPrefix: string
}

/** Round previous/next arrows around "PAGE x OF y"; both disabled at the bounds. */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  label,
  busy,
  testIdPrefix,
}: PaginationProps) {
  const pages = Math.max(1, totalPages)
  return (
    <nav aria-label={label} className="flex items-center justify-center gap-4">
      <IconButton
        icon="turnLeft"
        label="Previous page"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        data-testid={`${testIdPrefix}-prev`}
      />
      <p
        aria-live="polite"
        aria-atomic="true"
        data-testid={`${testIdPrefix}-status`}
        className="min-w-[7.5rem] text-center text-xs font-bold tracking-widest text-cream uppercase"
      >
        Page {page} of {pages}
      </p>
      <IconButton
        icon="turnRight"
        label="Next page"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        data-testid={`${testIdPrefix}-next`}
      />
      <span
        className="grid w-4 place-items-center"
        data-testid={`${testIdPrefix}-busy`}
        hidden={!busy}
      >
        {busy ? <Spinner small /> : null}
      </span>
    </nav>
  )
}
