import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { SCENARIO_IDS, SCENARIO_LABELS } from '../../contracts/scenarios.ts'
import type { ScenarioId } from '../../contracts/scenarios.ts'
import { resetMocks, setScenario, useScenario } from '../../mocks/index.ts'
import { Button, Dialog, LinkButton } from '../primitives/index.ts'

interface TriggerProps {
  /** `link` = discreet footer style, `button` = plank button (Options screen). */
  look?: 'link' | 'button'
}

/** Entry point of the network scenario panel (Options screen and menu footer). */
export function NetworkScenariosTrigger({ look = 'button' }: TriggerProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {look === 'link' ? (
        <LinkButton onClick={() => setOpen(true)} data-testid="scenarios-open">
          Network scenarios
        </LinkButton>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="scenarios-open"
        >
          Network scenarios
        </Button>
      )}
      {open ? <NetworkScenariosDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/**
 * Developer panel to simulate slow, failing or out-of-order APIs (README section 6).
 * Present in production builds too. Changing the scenario refreshes every query.
 */
function NetworkScenariosDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const current = useScenario()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [message, setMessage] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmingReset) confirmRef.current?.focus()
  }, [confirmingReset])

  const choose = (id: ScenarioId) => {
    setScenario(id)
    setMessage(`Scenario set to ${SCENARIO_LABELS[id]}.`)
    void queryClient.invalidateQueries()
  }

  const reset = () => {
    resetMocks()
    setConfirmingReset(false)
    setMessage('Mocks reset to the initial state.')
    void queryClient.invalidateQueries()
  }

  return (
    <Dialog
      testId="scenarios-dialog"
      title="Network scenarios"
      description="Simulate API conditions for the ranking and match history. The choice is remembered."
      onDismiss={onClose}
      size="md"
    >
      <fieldset className="text-left">
        <legend className="sr-only">Scenario</legend>
        <ul className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
          {SCENARIO_IDS.map((id) => (
            <li key={id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1 text-sm font-bold has-[:checked]:bg-[rgba(246,185,59,0.2)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white">
                <input
                  type="radio"
                  name="network-scenario"
                  value={id}
                  checked={current === id}
                  onChange={() => choose(id)}
                  className="size-4 accent-gold"
                  data-testid={`scenario-${id}`}
                />
                <span>{SCENARIO_LABELS[id]}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <p
        role="status"
        data-testid="scenarios-message"
        className="mt-3 min-h-[1.2rem] text-sm text-success short:mt-1"
      >
        {message}
      </p>

      {confirmingReset ? (
        <div
          role="group"
          aria-label="Confirm reset"
          className="mt-2 flex flex-col items-center gap-2 rounded-field bg-board-deep/70 p-3"
          data-testid="scenarios-reset-confirm"
        >
          <p className="text-sm">Reset the mock database, pending submissions and scenario?</p>
          <div className="flex gap-2">
            <Button ref={confirmRef} size="sm" onClick={reset} data-testid="scenarios-reset-yes">
              Yes, reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingReset(false)}
              data-testid="scenarios-reset-no"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmingReset(true)}
            data-testid="scenarios-reset"
          >
            Reset mocks
          </Button>
          <Button size="sm" onClick={onClose} data-testid="scenarios-close">
            Close
          </Button>
        </div>
      )}
    </Dialog>
  )
}
