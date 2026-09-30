import { useAppStore } from './state/appStore.ts'
import { GameScreen } from './ui/game/GameScreen.tsx'
import { RotateOverlay } from './ui/RotateOverlay.tsx'
import { LogScreen } from './ui/screens/LogScreen.tsx'
import { MenuScreen } from './ui/screens/MenuScreen.tsx'
import { OptionsScreen } from './ui/screens/OptionsScreen.tsx'
import { PlayerNameDialog } from './ui/screens/PlayerNameDialog.tsx'
import { ResultScreen } from './ui/screens/ResultScreen.tsx'

export default function App() {
  const screen = useAppStore((s) => s.screen)
  const matchNonce = useAppStore((s) => s.matchNonce)

  return (
    <>
      {screen === 'menu' ? <MenuScreen /> : null}
      {screen === 'options' ? <OptionsScreen /> : null}
      {screen === 'log' ? <LogScreen /> : null}
      {screen === 'game' ? <GameScreen key={matchNonce} /> : null}
      {screen === 'result' ? <ResultScreen /> : null}
      {/* Dialogs render after the screen so their focus wins over the screen heading's. */}
      <PlayerNameDialog />
      <RotateOverlay />
    </>
  )
}
