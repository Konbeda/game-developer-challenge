import { createElement, type ReactNode } from 'react'
import { AppQueryProvider } from './QueryProvider.tsx'

/** `.ts` test files cannot contain JSX; this is `AppQueryProvider` as a plain function. */
export function QueryProviderForTests({ children }: { children?: ReactNode }): ReactNode {
  return createElement(AppQueryProvider, null, children)
}
