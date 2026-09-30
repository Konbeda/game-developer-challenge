import { useState } from 'react'
import { useRanking } from '../../../api/hooks.ts'
import type { RankingEntry } from '../../../contracts/match.ts'
import { formatSeconds } from '../../../state/options.ts'
import { useOptionsStore } from '../../../state/optionsStore.ts'
import { usePlayerStore } from '../../../state/playerStore.ts'
import { formatPlayed, formatRank } from '../../lib/format.ts'
import { Badge, Icon, Table } from '../../primitives/index.ts'
import type { TableColumn } from '../../primitives/index.ts'
import { LOG_PAGE_SIZE } from './constants.ts'
import { LogRegion } from './LogRegion.tsx'

/** Ranking for the current options (same session time and spawn interval), highest score first. */
export function RankingTab() {
  const config = useOptionsStore((s) => s.config)
  const playerId = usePlayerStore((s) => s.playerId)
  const [page, setPage] = useState(1)
  const query = useRanking(config, page, LOG_PAGE_SIZE)

  const columns: TableColumn<RankingEntry>[] = [
    {
      key: 'rank',
      header: 'Rank',
      rowHeader: true,
      className: 'w-[14%]',
      render: (entry) => <span data-testid="ranking-rank">{formatRank(entry.rank)}</span>,
    },
    {
      key: 'captain',
      header: 'Captain',
      render: (entry) => (
        <span className="flex flex-wrap items-center gap-2">
          {entry.rank === 1 ? <Icon name="score" className="size-5" /> : null}
          <span data-testid="ranking-name" className="text-cream">
            {entry.playerName}
          </span>
          {entry.playerId === playerId ? <Badge tone="you">You</Badge> : null}
        </span>
      ),
    },
    {
      key: 'points',
      header: 'Points',
      className: 'w-[16%]',
      render: (entry) => (
        <span className="text-gold-bright" data-testid="ranking-points">
          {entry.score}
        </span>
      ),
    },
    {
      key: 'played',
      header: 'Played',
      className: 'w-[24%]',
      render: (entry) => (
        <time dateTime={entry.playedAt} className="text-xs font-semibold text-muted">
          {formatPlayed(entry.playedAt)}
        </time>
      ),
    },
  ]

  return (
    <LogRegion
      query={query}
      page={page}
      onPageChange={setPage}
      testPrefix="ranking"
      paginationLabel="Ranking pages"
      errorTitle="Ranking unavailable"
      emptyTitle="No scores yet"
      emptyMessage={`Nobody has set a score for ${config.sessionSeconds} second battles with a ${formatSeconds(config.spawnIntervalMs)} second spawn interval yet. Play one to be first on the board.`}
    >
      {(data, stale) => (
        <Table
          testId="ranking-table"
          rowTestId="ranking-row"
          stale={stale}
          caption={`${config.sessionSeconds} second battles · ${formatSeconds(config.spawnIntervalMs)} second spawn interval`}
          columns={columns}
          rows={data.items}
          getRowKey={(entry) => entry.matchId}
          isHighlighted={(entry) => entry.playerId === playerId}
        />
      )}
    </LogRegion>
  )
}
