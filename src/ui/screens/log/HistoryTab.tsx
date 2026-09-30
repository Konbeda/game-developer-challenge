import { useState } from 'react'
import { usePlayerMatches } from '../../../api/hooks.ts'
import type { MatchRecord } from '../../../contracts/match.ts'
import { useLastResultStore } from '../../../state/lastResultStore.ts'
import { usePlayerStore } from '../../../state/playerStore.ts'
import { END_REASON_LABELS, formatDuration, formatPlayed } from '../../lib/format.ts'
import { Table } from '../../primitives/index.ts'
import type { TableColumn } from '../../primitives/index.ts'
import { LOG_PAGE_SIZE } from './constants.ts'
import { LogRegion } from './LogRegion.tsx'

/** The current player's finished matches, newest first. The latest match is highlighted. */
export function HistoryTab() {
  const playerId = usePlayerStore((s) => s.playerId)
  const playerName = usePlayerStore((s) => s.playerName)
  const lastMatchId = useLastResultStore((s) => s.submission?.matchId ?? null)
  const [page, setPage] = useState(1)
  const query = usePlayerMatches(playerId, page, LOG_PAGE_SIZE)

  const columns: TableColumn<MatchRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      rowHeader: true,
      className: 'w-[30%]',
      render: (match) => {
        const [day = '', time = ''] = formatPlayed(match.playedAt).split(' · ')
        return (
          <time dateTime={match.playedAt} data-testid="history-date">
            <span className="text-cream">{day}</span>
            <span className="text-xs font-semibold text-muted"> · {time}</span>
          </time>
        )
      },
    },
    {
      key: 'points',
      header: 'Points',
      className: 'w-[18%]',
      render: (match) => (
        <span className="text-gold-bright" data-testid="history-score">
          {match.score}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-[22%]',
      render: (match) => (
        <span className="text-cream" data-testid="history-duration">
          {formatDuration(match.durationMs)}
        </span>
      ),
    },
    {
      key: 'result',
      header: 'Result',
      render: (match) => (
        <span
          data-testid="history-reason"
          className={
            match.endReason === 'time_up'
              ? 'text-xs font-bold tracking-wide text-success uppercase'
              : 'text-xs font-bold tracking-wide text-danger uppercase'
          }
        >
          {END_REASON_LABELS[match.endReason]}
        </span>
      ),
    },
  ]

  return (
    <LogRegion
      query={query}
      page={page}
      onPageChange={setPage}
      testPrefix="history"
      paginationLabel="Match history pages"
      errorTitle="History unavailable"
      emptyTitle="No battles yet"
      emptyMessage="Finish a match and it will be listed here."
    >
      {(data, stale) => (
        <Table
          testId="history-table"
          rowTestId="history-row"
          stale={stale}
          caption={`${playerName} · your recent battles`}
          columns={columns}
          rows={data.items}
          getRowKey={(match) => match.matchId}
          isHighlighted={(match) => match.matchId === lastMatchId}
        />
      )}
    </LogRegion>
  )
}
