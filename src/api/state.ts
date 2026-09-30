import { resetOutbox } from './outbox.ts'
import { queryClient } from './queryClient.ts'

/**
 * Total client-side reset used by `resetMocks()`: forgets every queued/confirmed submission (the
 * outbox is cleared together with the mock server data so nothing is re-sent after a reset) and
 * resets the query cache, cancelling in-flight requests; active screens refetch immediately.
 */
export function resetApiState(): void {
  resetOutbox()
  void queryClient.resetQueries()
}
