import { useState } from 'react'
import type { FormEvent } from 'react'
import { LIMITS } from '../../config/limits.ts'
import {
  canStepSession,
  canStepSpawn,
  configToDraft,
  formatSeconds,
  stepSessionSeconds,
  stepSpawnSeconds,
  validateDraft,
} from '../../state/options.ts'
import type { OptionsDraft, OptionsErrors } from '../../state/options.ts'
import { DEFAULT_MATCH_CONFIG } from '../../contracts/match.ts'
import { useAppStore } from '../../state/appStore.ts'
import { useOptionsStore } from '../../state/optionsStore.ts'
import { Button, NumberField, Panel, Scene, ScreenTitle } from '../primitives/index.ts'
import { NetworkScenariosTrigger } from './NetworkScenarios.tsx'

type SaveStatus = { kind: 'idle' } | { kind: 'saved' } | { kind: 'session-only' }

export function OptionsScreen() {
  const go = useAppStore((s) => s.go)
  const saved = useOptionsStore((s) => s.config)
  const save = useOptionsStore((s) => s.save)
  const [draft, setDraft] = useState<OptionsDraft>(() => configToDraft(saved))
  const [errors, setErrors] = useState<OptionsErrors>({})
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })

  const update = (patch: Partial<OptionsDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setStatus({ kind: 'idle' })
    // Validate while typing, but stay quiet about fields the player has not touched yet.
    const result = validateDraft(next)
    const touched = Object.keys(patch) as (keyof OptionsDraft)[]
    const nextErrors: OptionsErrors = { ...errors }
    for (const key of touched) {
      if (result.ok) delete nextErrors[key]
      else if (result.errors[key]) nextErrors[key] = result.errors[key]
      else delete nextErrors[key]
    }
    setErrors(nextErrors)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateDraft(draft)
    if (!result.ok) {
      setErrors(result.errors)
      setStatus({ kind: 'idle' })
      return
    }
    setErrors({})
    const outcome = save(result.config)
    // Normalise what is shown (e.g. "2,5" -> "2.5").
    setDraft(configToDraft(result.config))
    setStatus(outcome.persisted ? { kind: 'saved' } : { kind: 'session-only' })
  }

  const { sessionSeconds: sessionLimits, spawnIntervalMs: spawnLimits } = LIMITS

  return (
    <Scene testId="screen-options" screen="options">
      <Panel className="w-[min(30rem,100%)] short:w-[min(44rem,100%)]" aria-label="Options">
        <form
          onSubmit={onSubmit}
          noValidate
          className="skin-scroll flex min-h-0 flex-col items-center gap-2 overflow-y-auto px-1"
          data-testid="options-form"
        >
          <ScreenTitle testId="options-title" className="short:text-[1.5rem]">
            Options
          </ScreenTitle>

          <div className="flex w-full flex-col items-center gap-2 short:grid short:grid-cols-2 short:items-start short:gap-3">
            <NumberField
              label="Game session time"
              hint={`${sessionLimits.min}-${sessionLimits.max} seconds`}
              unit="s"
              value={draft.sessionSeconds}
              min={sessionLimits.min}
              max={sessionLimits.max}
              error={errors.sessionSeconds}
              canDecrease={canStepSession(draft.sessionSeconds, -1)}
              canIncrease={canStepSession(draft.sessionSeconds, 1)}
              onChange={(sessionSeconds) => update({ sessionSeconds })}
              onStep={(direction) =>
                update({ sessionSeconds: stepSessionSeconds(draft.sessionSeconds, direction) })
              }
              testId="options-session"
            />
            <NumberField
              label="Enemy spawn time"
              hint={`${formatSeconds(spawnLimits.min)}-${formatSeconds(spawnLimits.max)} seconds, in steps of 0.1`}
              unit="s"
              value={draft.spawnSeconds}
              min={spawnLimits.min / 1000}
              max={spawnLimits.max / 1000}
              error={errors.spawnSeconds}
              canDecrease={canStepSpawn(draft.spawnSeconds, -1)}
              canIncrease={canStepSpawn(draft.spawnSeconds, 1)}
              onChange={(spawnSeconds) => update({ spawnSeconds })}
              onStep={(direction) =>
                update({ spawnSeconds: stepSpawnSeconds(draft.spawnSeconds, direction) })
              }
              testId="options-spawn"
            />
          </div>

          <p
            role="status"
            data-testid="options-status"
            className="min-h-[1.2rem] text-center text-sm font-bold text-success"
          >
            {status.kind === 'saved' ? 'Options saved.' : null}
            {status.kind === 'session-only' ? (
              <span className="text-gold-bright">
                Saved for this session only: storage is unavailable.
              </span>
            ) : null}
          </p>

          <div className="flex flex-col items-center gap-2 short:flex-row short:flex-wrap short:justify-center">
            <Button type="submit" data-testid="options-save">
              Save
            </Button>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft(configToDraft(DEFAULT_MATCH_CONFIG))
                  setErrors({})
                  setStatus({ kind: 'idle' })
                }}
                data-testid="options-defaults"
              >
                Defaults
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => go('menu')}
                data-testid="options-back"
              >
                Back
              </Button>
              <NetworkScenariosTrigger />
            </div>
          </div>
        </form>
      </Panel>
    </Scene>
  )
}
