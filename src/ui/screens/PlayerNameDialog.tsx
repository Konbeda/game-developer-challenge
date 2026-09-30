import { useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_PLAYER_NAME, LIMITS } from '../../config/limits.ts'
import { useAppStore } from '../../state/appStore.ts'
import { usePlayerStore } from '../../state/playerStore.ts'
import { Button, Dialog, Field, TextInput } from '../primitives/index.ts'

/** First-visit name prompt and the "Change name" editor. Skipping never blocks the game. */
export function PlayerNameDialog() {
  const mode = useAppStore((s) => s.nameDialog)
  if (mode === 'closed') return null
  return <NameDialogContent key={mode} mode={mode} />
}

function NameDialogContent({ mode }: { mode: 'first' | 'edit' }) {
  const closeNameDialog = useAppStore((s) => s.closeNameDialog)
  const currentName = usePlayerStore((s) => s.playerName)
  const setName = usePlayerStore((s) => s.setName)
  const keepName = usePlayerStore((s) => s.keepName)
  const [value, setValue] = useState(mode === 'edit' ? currentName : '')
  const [error, setError] = useState<string | null>(null)
  const isFirst = mode === 'first'

  const dismiss = () => {
    if (isFirst) keepName()
    closeNameDialog()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = setName(value)
    if (message) {
      setError(message)
      return
    }
    closeNameDialog()
  }

  return (
    <Dialog
      testId="name-dialog"
      title={isFirst ? 'Welcome, Captain' : 'Change name'}
      description={
        isFirst
          ? `Pick the name shown in the Captain’s Log. Skip to sail as “${DEFAULT_PLAYER_NAME}”.`
          : 'This name appears next to your scores.'
      }
      onDismiss={dismiss}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field
          label="Captain name"
          hint={`${LIMITS.playerName.min}-${LIMITS.playerName.max} characters: letters, numbers, spaces, "_" or "-".`}
          error={error}
          testId="name"
        >
          {(control) => (
            <TextInput
              {...control}
              value={value}
              placeholder={DEFAULT_PLAYER_NAME}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setValue(event.target.value)
                if (error) setError(null)
              }}
              data-testid="name-input"
            />
          )}
        </Field>
        <div className="flex flex-col items-center gap-2">
          <Button type="submit" data-testid="name-submit">
            {isFirst ? 'Set sail' : 'Save name'}
          </Button>
          <Button variant="secondary" size="sm" onClick={dismiss} data-testid="name-skip">
            {isFirst ? 'Skip' : 'Cancel'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
