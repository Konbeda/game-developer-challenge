import type { ReactNode } from 'react'

interface SceneProps {
  children: ReactNode
  testId: string
  /** Screen id, exposed as `data-screen` for tests and analytics. */
  screen: string
}

/** Full-screen water/island backdrop and the `main` landmark of a menu screen. */
export function Scene({ children, testId, screen }: SceneProps) {
  return (
    <main className="scene" data-testid={testId} data-screen={screen}>
      {children}
    </main>
  )
}
