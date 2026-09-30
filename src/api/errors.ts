import axios from 'axios'
import { apiErrorSchema } from '../contracts/api.ts'

/**
 * Normalised failure of an API call. Every rejection that leaves `src/api` is an `ApiError`, so the
 * UI never has to inspect Axios internals, and `message` is always safe to render.
 *
 *  network           request never reached the server / connection failure
 *  timeout           no answer within the client timeout
 *  http              the server answered with a non-2xx status (`status` is set)
 *  invalid_response  2xx answer that does not match the contract (zod validation failed)
 *  aborted           cancelled by the caller (unmount, superseded query); never shown to users
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'invalid_response' | 'aborted'

export interface ApiErrorInit {
  kind: ApiErrorKind
  message: string
  status?: number | null
  code?: string | null
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly code: string | null

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status ?? null
    this.code = init.code ?? null
  }

  /** Worth retrying automatically: transient conditions only (never validation/4xx errors). */
  get retryable(): boolean {
    switch (this.kind) {
      case 'network':
      case 'timeout':
        return true
      case 'http': {
        const status = this.status ?? 0
        return status >= 500 || status === 408 || status === 425 || status === 429
      }
      default:
        return false
    }
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export const MESSAGES = {
  network: 'Cannot reach the server. Check your connection and try again.',
  timeout: 'The server took too long to respond. Please try again.',
  invalidResponse: 'The server sent an unexpected response. Please try again later.',
  aborted: 'The request was cancelled.',
  unavailable: 'The service is temporarily unavailable. Please try again in a moment.',
  server: 'The server had a problem. Please try again in a moment.',
  tooManyRequests: 'Too many requests. Please wait a moment and try again.',
  conflict: 'This match was already registered with different data.',
  unknown: 'Something went wrong while contacting the server.',
} as const

function httpMessage(status: number, serverMessage: string | null): string {
  if (status === 409) return MESSAGES.conflict
  if (status === 429) return MESSAGES.tooManyRequests
  if (status === 503) return MESSAGES.unavailable
  if (status >= 500) return MESSAGES.server
  // 4xx: the (bounded, contract-validated) server message explains what to fix; it is rendered as text.
  return serverMessage ?? `The request was rejected (HTTP ${status}).`
}

/** Converts anything thrown by Axios (or by our own code) into an `ApiError`. Never throws. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (axios.isCancel(error)) return new ApiError({ kind: 'aborted', message: MESSAGES.aborted })
  if (axios.isAxiosError(error)) {
    const response = error.response
    if (response) {
      const body = apiErrorSchema.safeParse(response.data)
      return new ApiError({
        kind: 'http',
        status: response.status,
        code: body.success ? body.data.error.code : null,
        message: httpMessage(response.status, body.success ? body.data.error.message : null),
      })
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError({ kind: 'timeout', message: MESSAGES.timeout, code: error.code })
    }
    return new ApiError({ kind: 'network', message: MESSAGES.network, code: error.code ?? null })
  }
  return new ApiError({ kind: 'network', message: MESSAGES.unknown })
}
