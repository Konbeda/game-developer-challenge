import { enqueueMatch } from '../../api/outbox.ts'
import type { MatchResult } from '../../contracts/match.ts'
import type { MatchSettings } from '../../game/contracts.ts'
import { useAppStore } from '../../state/appStore.ts'
import { useLastResultStore } from '../../state/lastResultStore.ts'
import { usePlayerStore } from '../../state/playerStore.ts'
import { buildSubmission } from '../../state/submission.ts'

/**
 * Called once when the host reports the end of a match: builds the submission, persists it as
 * the last result, queues it for the API (never throwing into the game) and shows the result.
 */
export function completeMatch(result: MatchResult, settings: MatchSettings): void {
  const { playerId, playerName } = usePlayerStore.getState()
  const built = buildSubmission({ result, settings, player: { playerId, playerName } })
  const lastResult = useLastResultStore.getState()

  if (built.ok) {
    lastResult.setSubmission(built.submission)
    try {
      enqueueMatch(built.submission)
    } catch (error) {
      // The outbox is contractually non-throwing; if it ever does, the result screen must still appear.
      console.error('Could not queue the match for recording', error)
    }
  } else {
    lastResult.setUnrecorded(result, built.error)
  }
  useAppStore.getState().go('result')
}
