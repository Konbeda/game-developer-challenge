import { Button, Panel, Scene, ScreenTitle } from './primitives/index.ts'

interface CrashScreenProps {
  onRetry: () => void
}

/** Last-resort fallback of the error boundary: the app failed to render, offer a way back. */
export function CrashScreen({ onRetry }: CrashScreenProps) {
  return (
    <Scene testId="screen-crash" screen="crash">
      <Panel className="w-[min(26rem,100%)]" aria-label="Error">
        <div role="alert" className="flex flex-col items-center gap-3 px-1 text-center">
          <ScreenTitle className="text-[1.6rem]">Man overboard</ScreenTitle>
          <p className="text-sm text-cream">
            Something went wrong and the game had to stop. Your saved options and scores are safe.
          </p>
          <div className="flex flex-col items-center gap-2">
            <Button onClick={onRetry} data-testid="crash-retry">
              Try again
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.location.reload()}
              data-testid="crash-reload"
            >
              Reload page
            </Button>
          </div>
        </div>
      </Panel>
    </Scene>
  )
}
