import { MAX_LIST_LIMIT, ROLES, type ListUsersRequest, type Role } from '../../../contracts/adminUsers'
import { MAX_PAGE, MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from './limits'

export const DEFAULT_PAGE_SIZE = 20

export interface AdminUsersFilters {
  readonly search: string
  readonly role: Role | undefined
  readonly active: boolean | undefined
  readonly page: number // 1-based
  readonly limit: number
}

function parsePositiveInt(raw: string | null, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : undefined
}

// Termos curtos demais são descartados; os longos são truncados.
function parseSearch(raw: string | null): string {
  const trimmed = (raw ?? '').trim().slice(0, MAX_SEARCH_LENGTH).trim()
  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : ''
}

function parseRole(raw: string | null): Role | undefined {
  return (ROLES as readonly string[]).includes(raw ?? '') ? (raw as Role) : undefined
}

function parseActive(raw: string | null): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

// Valida e limita valores vindos da URL (entrada não confiável).
export function parseFilters(params: URLSearchParams): AdminUsersFilters {
  const limit = Math.min(parsePositiveInt(params.get('limit')) ?? DEFAULT_PAGE_SIZE, MAX_LIST_LIMIT)
  return {
    search: parseSearch(params.get('q')),
    role: parseRole(params.get('role')),
    active: parseActive(params.get('active')),
    page: parsePositiveInt(params.get('page'), MAX_PAGE) ?? 1,
    limit,
  }
}

// Omite valores default para manter a URL curta.
export function toSearchParams(filters: AdminUsersFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('q', filters.search)
  if (filters.role) params.set('role', filters.role)
  if (filters.active !== undefined) params.set('active', String(filters.active))
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.limit !== DEFAULT_PAGE_SIZE) params.set('limit', String(filters.limit))
  return params
}

export function toListRequest(filters: AdminUsersFilters): ListUsersRequest {
  return {
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    limit: filters.limit,
    offset: (filters.page - 1) * filters.limit,
  }
}
