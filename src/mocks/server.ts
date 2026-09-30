import { setupServer } from 'msw/node'
import { handlers } from './handlers.ts'

/** Node instance sharing the exact browser handlers (Vitest and other Node tooling). */
export const server = setupServer(...handlers)
