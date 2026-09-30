// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MATCH_CONFIG } from '../contracts/match.ts'
import { getRequestLog } from '../mocks/requestLog.ts'
import { setScenario } from '../mocks/scenario.ts'
import { setupMockServer } from '../mocks/testing.ts'
import { makeSubmission } from '../mocks/testUtils.ts'
import { QueryProviderForTests } from './hooksTestSupport.ts'
import { usePlayerMatches, useMatchSubmission, useRanking } from './hooks.ts'
import { enqueueMatch } from './outbox.ts'
import { queryClient } from './queryClient.ts'

setupMockServer()

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLAYER = 'player-test-0001'

interface Harness<T> {
  result: { current: T; renders: number }
  rerender: () => void
  unmount: () => void
}

const roots: Root[] = []

function renderHook<T>(hook: () => T, options: { strict?: boolean } = {}): Harness<T> {
  const result = { current: undefined as T, renders: 0 }
  function Probe(): ReactNode {
    result.current = hook()
    result.renders += 1
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  const tree = () => {
    const inner = createElement(QueryProviderForTests, null, createElement(Probe))
    return options.strict ? createElement(StrictMode, null, inner) : inner
  }
  act(() => root.render(tree()))
  return {
    result,
    rerender: () => act(() => root.render(tree())),
    unmount: () => act(() => root.unmount()),
  }
}

const settle = (assertion: () => void) => act(async () => vi.waitFor(assertion, { timeout: 4_000 }))

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  queryClient.clear()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  // No React warning (act, keys, ...) and no unhandled error may appear in normal flows.
  expect(consoleError).not.toHaveBeenCalled()
  consoleError.mockRestore()
})

describe('useMatchSubmission', () => {
  it('returns null for a null or unknown matchId', () => {
    expect(renderHook(() => useMatchSubmission(null)).result.current).toBeNull()
    expect(renderHook(() => useMatchSubmission('never-enqueued-1')).result.current).toBeNull()
  })

  it('follows the outbox: pending/syncing -> synced with the record', async () => {
    const submission = makeSubmission({ playerId: PLAYER, score: 5 })
    const { result } = renderHook(() => useMatchSubmission(submission.matchId))
    expect(result.current).toBeNull()
    act(() => enqueueMatch(submission))
    expect(result.current?.status).toBe('pending')
    expect(result.current?.record).toBeNull()
    await settle(() => expect(result.current?.status).toBe('synced'))
    expect(result.current?.record).toMatchObject({ matchId: submission.matchId, score: 5 })
    expect(result.current?.error).toBeNull()
  })

  it('exposes failures with a user-safe error and a working, stable retry', async () => {
    setScenario('submit_outage')
    const submission = makeSubmission({ playerId: PLAYER })
    const { result, rerender } = renderHook(() => useMatchSubmission(submission.matchId))
    act(() => enqueueMatch(submission))
    await settle(() => expect(result.current?.status).toBe('failed'))
    expect(result.current?.error).toMatch(/unavailable/i)
    const retry = result.current!.retry
    rerender()
    expect(result.current?.retry).toBe(retry) // stable identity

    setScenario('success')
    act(() => result.current?.retry())
    await settle(() => expect(result.current?.status).toBe('synced'))
    expect(result.current?.error).toBeNull()
    expect(getRequestLog().filter((r) => r.method === 'POST')).toHaveLength(2)
  })

  it('does not re-render when other matches change (no render storms)', async () => {
    const mine = makeSubmission({ playerId: PLAYER })
    const other = makeSubmission({ playerId: PLAYER })
    const { result } = renderHook(() => useMatchSubmission(mine.matchId))
    act(() => enqueueMatch(mine))
    await settle(() => expect(result.current?.status).toBe('synced'))
    const rendersBefore = result.renders
    const snapshot = result.current
    act(() => enqueueMatch(other))
    await act(async () => {
      await vi.waitFor(() =>
        expect(getRequestLog().filter((r) => r.method === 'POST')).toHaveLength(2),
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(result.renders).toBe(rendersBefore)
    expect(result.current).toBe(snapshot)
  })

  it('switches when the matchId changes and survives Strict Mode', async () => {
    const a = makeSubmission({ playerId: PLAYER })
    let id: string | null = null
    const { result, rerender } = renderHook(() => useMatchSubmission(id), { strict: true })
    expect(result.current).toBeNull()
    act(() => {
      enqueueMatch(a)
      enqueueMatch(a) // Strict Mode effects call it twice in real code
    })
    id = a.matchId
    rerender()
    await settle(() => expect(result.current?.status).toBe('synced'))
    expect(getRequestLog().filter((r) => r.method === 'POST')).toHaveLength(1)
    id = null
    rerender()
    expect(result.current).toBeNull()
  })
})

describe('useRanking / usePlayerMatches', () => {
  it('useRanking: loading, then a validated page (default pageSize 10)', async () => {
    const { result } = renderHook(() => useRanking(DEFAULT_MATCH_CONFIG, 1))
    expect(result.current.isPending).toBe(true)
    await settle(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ page: 1, pageSize: 10, total: 27, totalPages: 3 })
    expect(result.current.isFetching).toBe(false)
  })

  it('useRanking: changing page keeps the previous data while fetching', async () => {
    let page = 1
    const { result, rerender } = renderHook(() => useRanking(DEFAULT_MATCH_CONFIG, page, 10))
    await settle(() => expect(result.current.isSuccess).toBe(true))
    page = 2
    rerender()
    expect(result.current.data?.page).toBe(1)
    expect(result.current.isPlaceholderData).toBe(true)
    await settle(() => expect(result.current.data?.page).toBe(2))
    expect(result.current.isPlaceholderData).toBe(false)
  })

  it('usePlayerMatches: empty state, then the history after a match is confirmed', async () => {
    const { result } = renderHook(() => usePlayerMatches(PLAYER, 1))
    await settle(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.total).toBe(0)
    const submission = makeSubmission({ playerId: PLAYER })
    act(() => enqueueMatch(submission))
    await settle(() => expect(result.current.data?.total).toBe(1))
    expect(result.current.data?.items[0]?.matchId).toBe(submission.matchId)
  })

  it('surfaces errors as typed ApiError values and recovers via refetch', async () => {
    setScenario('ranking_fails')
    const { result } = renderHook(() => useRanking(DEFAULT_MATCH_CONFIG, 1))
    await settle(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ name: 'ApiError', kind: 'http', status: 500 })
    expect(result.current.error?.message).not.toMatch(/axios|mock/i)
    setScenario('success')
    act(() => {
      void result.current.refetch()
    })
    await settle(() => expect(result.current.data?.total).toBe(27))
    expect(result.current.isError).toBe(false)
  })

  it('works under Strict Mode without console errors and quietly cancels superseded requests', async () => {
    const { result } = renderHook(() => useRanking(DEFAULT_MATCH_CONFIG, 1), { strict: true })
    await settle(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.error).toBeNull()
    const { unmount } = renderHook(() => usePlayerMatches(PLAYER, 1))
    unmount() // unmounting mid-flight aborts the request without surfacing an error
  })
})
