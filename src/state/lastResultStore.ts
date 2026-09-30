import { create } from 'zustand'
import { matchSubmissionSchema } from '../contracts/match.ts'
import type { MatchResult, MatchSubmission } from '../contracts/match.ts'
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage.ts'

interface LastResultState {
  /** Last completed match (persisted). A submission carries every field the result view needs. */
  submission: MatchSubmission | null
  /**
   * A finished match whose data failed validation, so it could not be recorded. Kept in memory
   * only, just to show the result screen honestly.
   */
  unrecorded: { result: MatchResult; error: string } | null
  setSubmission: (submission: MatchSubmission) => void
  setUnrecorded: (result: MatchResult, error: string) => void
}

export const useLastResultStore = create<LastResultState>((set) => ({
  submission: readStorage(STORAGE_KEYS.lastResult, matchSubmissionSchema.nullable(), null),
  unrecorded: null,
  setSubmission: (submission) => {
    writeStorage(STORAGE_KEYS.lastResult, submission)
    set({ submission, unrecorded: null })
  },
  setUnrecorded: (result, error) => set({ unrecorded: { result, error } }),
}))
