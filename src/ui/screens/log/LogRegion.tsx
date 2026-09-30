import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  Spinner,
} from '../../primitives/index.ts'

interface PageData {
  items: readonly unknown[]
  totalPages: number
}

interface LogRegionProps<T extends PageData> {
  query: UseQueryResult<T>
  page: number
  onPageChange: (page: number) => void
  /** Prefix of the data-testid values: `<prefix>-loading`, `-empty`, `-error`, `-pagination`... */
  testPrefix: string
  paginationLabel: string
  emptyTitle: string
  emptyMessage: string
  errorTitle: string
  children: (data: T, stale: boolean) => ReactNode
}

/** Keeps the last successful page so paging or refetching never blanks the table. */
function useStickyData<T>(data: T | undefined): T | undefined {
  const [last, setLast] = useState<T | undefined>(undefined)
  // Derived state (React docs: adjusting state while rendering): remember the newest real data.
  if (data !== undefined && data !== last) setLast(data)
  return data ?? last
}

/**
 * The states every log tab shares: first load, empty, error (with Retry), background refresh
 * and pagination. Errors never hide data we already have and never block navigation.
 */
export function LogRegion<T extends PageData>({
  query,
  page,
  onPageChange,
  testPrefix,
  paginationLabel,
  emptyTitle,
  emptyMessage,
  errorTitle,
  children,
}: LogRegionProps<T>) {
  const { refetch } = query
  // Showing a tab again refreshes it (README section 5); cancelRefetch:false joins an in-flight request.
  useEffect(() => {
    void refetch({ cancelRefetch: false })
  }, [refetch])

  const data = useStickyData(query.data)
  const stale =
    query.isPlaceholderData || (query.isFetching && data !== undefined && query.data === undefined)
  const refreshing = query.isFetching && data !== undefined
  const errorMessage = query.error instanceof Error ? query.error.message : 'The request failed.'

  // The page may vanish (e.g. mocks reset while on page 3): step back to the last real page.
  const totalPages = data?.totalPages ?? 0
  useEffect(() => {
    const lastPage = Math.max(1, totalPages)
    if (!query.isPlaceholderData && query.data && page > lastPage) onPageChange(lastPage)
  }, [page, totalPages, query.data, query.isPlaceholderData, onPageChange])

  let body: ReactNode
  if (!data && query.isError) {
    body = (
      <ErrorState
        testId={`${testPrefix}-error`}
        title={errorTitle}
        message={`${errorMessage} You can keep playing while this is unavailable.`}
        onRetry={() => void refetch()}
        retrying={query.isFetching}
      />
    )
  } else if (!data) {
    body = <LoadingState testId={`${testPrefix}-loading`} label="Loading…" skeletonRows={4} />
  } else if (data.items.length === 0) {
    body = <EmptyState testId={`${testPrefix}-empty`} title={emptyTitle} message={emptyMessage} />
  } else {
    body = children(data, stale)
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-2"
      data-testid={`${testPrefix}-region`}
    >
      {/* Non-blocking background refresh indicator: never shifts the layout. */}
      <span
        role="status"
        data-testid={`${testPrefix}-refreshing`}
        className="absolute top-0 right-1 z-10 flex items-center gap-1.5 text-[0.62rem] font-bold tracking-wider text-muted uppercase"
        hidden={!refreshing}
      >
        {refreshing ? (
          <>
            <Spinner small />
            Updating…
          </>
        ) : null}
      </span>

      <div
        className="skin-scroll min-h-0 flex-1 overflow-y-auto"
        data-testid={`${testPrefix}-body`}
      >
        {body}
      </div>

      {data && query.isError ? (
        <div
          role="alert"
          data-testid={`${testPrefix}-stale-error`}
          className="flex flex-wrap items-center justify-center gap-2 text-xs text-danger"
        >
          <span>Could not refresh. Showing the last data.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            data-testid={`${testPrefix}-stale-retry`}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <Pagination
          label={paginationLabel}
          page={page}
          totalPages={data.totalPages}
          onPageChange={onPageChange}
          busy={query.isFetching}
          testIdPrefix={`${testPrefix}-pagination`}
        />
      ) : null}
    </div>
  )
}
