import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import type { z } from 'zod'
import { ApiError, MESSAGES, toApiError } from './errors.ts'
import { getRuntimeOptions } from './runtimeOptions.ts'

export const DEFAULT_TIMEOUT_MS = 8_000
export const DEFAULT_QUERY_RETRIES = 2

export interface ApiConfig {
  /** Client-side request timeout in ms. */
  timeoutMs?: number
  /** Automatic retries of failed GET queries (TanStack Query). 0 disables them. */
  queryRetries?: number
}

let configuredTimeoutMs = DEFAULT_TIMEOUT_MS
let configuredQueryRetries = DEFAULT_QUERY_RETRIES

/**
 * Module-level knobs (tests, tooling). The URL query (`?timeoutMs=`, `?retry=`, see
 * `runtimeOptions.ts`) takes precedence over these values.
 */
export function configureApi(config: ApiConfig): void {
  if (config.timeoutMs !== undefined && config.timeoutMs > 0) configuredTimeoutMs = config.timeoutMs
  if (config.queryRetries !== undefined && config.queryRetries >= 0) {
    configuredQueryRetries = Math.floor(config.queryRetries)
  }
}

export function resetApiConfig(): void {
  configuredTimeoutMs = DEFAULT_TIMEOUT_MS
  configuredQueryRetries = DEFAULT_QUERY_RETRIES
}

export function getTimeoutMs(): number {
  return getRuntimeOptions().timeoutMs ?? configuredTimeoutMs
}

export function getQueryRetries(): number {
  return getRuntimeOptions().retry ?? configuredQueryRetries
}

/** Same-origin client (MSW answers in the browser and in tests; a real backend would live here). */
export const apiClient = axios.create({
  baseURL: '',
  headers: { Accept: 'application/json' },
})

/**
 * Performs a request and validates the body with `schema`. Rejects only with `ApiError`; a payload
 * that does not match the contract never reaches the caller (`invalid_response`).
 */
export async function requestJson<S extends z.ZodType>(
  config: AxiosRequestConfig,
  schema: S,
): Promise<z.infer<S>> {
  let response: AxiosResponse<unknown>
  try {
    response = await apiClient.request<unknown>({ ...config, timeout: getTimeoutMs() })
  } catch (error) {
    throw toApiError(error)
  }
  const parsed = schema.safeParse(response.data)
  if (!parsed.success) {
    throw new ApiError({
      kind: 'invalid_response',
      status: response.status,
      message: MESSAGES.invalidResponse,
    })
  }
  return parsed.data
}
