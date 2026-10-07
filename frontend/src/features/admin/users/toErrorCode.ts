import { AdminUsersApiError } from './api'
import type { AdminUsersUiErrorCode } from './errors'

// Unknown/transport failures collapse to the generic 'internal' code.
export function toErrorCode(error: unknown): AdminUsersUiErrorCode {
  return error instanceof AdminUsersApiError ? error.code : 'internal'
}
