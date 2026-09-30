import { useAppStore } from '../../state/appStore.ts'
import type { LogTab } from '../../state/appStore.ts'
import { Button, Panel, Scene, ScreenTitle, TabPanel, Tabs } from '../primitives/index.ts'
import type { TabDef } from '../primitives/index.ts'
import { HistoryTab } from './log/HistoryTab.tsx'
import { RankingTab } from './log/RankingTab.tsx'

const TABS: readonly TabDef<LogTab>[] = [
  { id: 'ranking', label: 'Ranking', testId: 'tab-ranking' },
  { id: 'history', label: 'Match History', testId: 'tab-history' },
]

/** Captain's Log: the Ranking and Match History tabs. Only the visible tab is mounted, so showing one again refreshes it. */
export function LogScreen() {
  const tab = useAppStore((s) => s.logTab)
  const setLogTab = useAppStore((s) => s.setLogTab)
  const go = useAppStore((s) => s.go)

  return (
    <Scene testId="screen-log" screen="log">
      <Panel className="h-[min(36rem,100%)] w-[min(52rem,100%)]" aria-label="Captain's Log">
        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-3 short:gap-1.5">
          <ScreenTitle testId="log-title" className="text-center short:text-[1.5rem]">
            Captain&rsquo;s Log
          </ScreenTitle>
          <Tabs label="Captain's Log" tabs={TABS} value={tab} onChange={setLogTab} idPrefix="log" />
          <TabPanel
            idPrefix="log"
            id={tab}
            className="flex min-h-0 flex-1 flex-col outline-none"
            testId={`panel-${tab}`}
          >
            {tab === 'ranking' ? <RankingTab /> : <HistoryTab />}
          </TabPanel>
          <div className="flex justify-center">
            <Button onClick={() => go('menu')} data-testid="log-main-menu">
              Main menu
            </Button>
          </div>
        </div>
      </Panel>
    </Scene>
  )
}
