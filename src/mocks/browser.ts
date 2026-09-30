import { setupWorker } from 'msw/browser'
import { handlers } from './handlers.ts'

/** Browser (Service Worker) instance. Imported lazily by `enableMocking()`. */
export const worker = setupWorker(...handlers)
