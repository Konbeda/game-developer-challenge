/**
 * Bounded log of the requests the mock handlers served (method, path, scenario, sequence number).
 * Lets tests and E2E assert how many attempts were made (retries, single-flight) without spying on
 * the network layer.
 */
export interface LoggedRequest {
  seq: number
  method: 'GET' | 'POST'
  path: string
  scenario: string
}

const MAX_ENTRIES = 200
let seq = 0
let entries: LoggedRequest[] = []

export function logRequest(method: 'GET' | 'POST', path: string, scenario: string): void {
  seq += 1
  entries.push({ seq, method, path, scenario })
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
}

export function getRequestLog(): readonly LoggedRequest[] {
  return entries
}

export function clearRequestLog(): void {
  entries = []
  seq = 0
}
