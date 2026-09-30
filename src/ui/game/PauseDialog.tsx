import { useMediaQuery } from '../lib/media.ts'
import { Button, Dialog } from '../primitives/index.ts'
import { ControlsList } from './ControlsList.tsx'

interface PauseDialogProps {
  /** Manual pauses can be resumed with Escape; automatic ones (blur, hidden tab) need the button. */
  escapeResumes: boolean
  touch: boolean
  onResume: () => void
  onRestart: () => void
  onMainMenu: () => void
}

/** Pause menu. Resuming always takes an explicit action from the player. */
export function PauseDialog({
  escapeResumes,
  touch,
  onResume,
  onRestart,
  onMainMenu,
}: PauseDialogProps) {
  // Short landscape phones: buttons and controls side by side so nothing needs scrolling.
  const short = useMediaQuery('(max-height: 460px)')
  return (
    <Dialog
      testId="pause-dialog"
      size={short ? 'md' : 'sm'}
      title="Paused"
      description="Ready when you are."
      onDismiss={escapeResumes ? onResume : undefined}
      restoreFocus={false}
    >
      <div className="flex flex-col gap-3 short:grid short:grid-cols-[auto_1fr] short:items-start">
        <div className="flex flex-col items-center gap-2">
          <Button onClick={onResume} data-testid="pause-resume">
            Resume
          </Button>
          <Button onClick={onRestart} data-testid="pause-restart">
            Restart
          </Button>
          <Button onClick={onMainMenu} data-testid="pause-main-menu">
            Main menu
          </Button>
        </div>
        <div className="text-left">
          <ControlsList mode={touch ? 'touch' : 'keyboard'} testId="pause-controls" />
        </div>
      </div>
    </Dialog>
  )
}
