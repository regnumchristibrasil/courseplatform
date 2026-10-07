import { describe, expect, it } from 'vitest'
import { ADMIN_USERS_ERROR_STATUS, type AdminUsersErrorCode } from '../../../contracts/adminUsers'
import { describeAdminUsersError } from './errors'

const CODES = Object.keys(ADMIN_USERS_ERROR_STATUS) as AdminUsersErrorCode[]

describe('describeAdminUsersError', () => {
  it.each(CODES)('maps %s to a non-empty pt-BR message', (code) => {
    const view = describeAdminUsersError(code)
    expect(view.message.length).toBeGreaterThan(10)
  })

  it('offers retry only for auth_sync_failed', () => {
    for (const code of CODES) {
      expect(describeAdminUsersError(code).action).toBe(code === 'auth_sync_failed' ? 'retry' : code === 'stale_target' ? 'reload' : 'none')
    }
  })

  it('asks to reload the list on stale_target', () => {
    expect(describeAdminUsersError('stale_target').message).toMatch(/recarregue a lista/i)
  })

  it('uses accents in pt-BR copy', () => {
    expect(describeAdminUsersError('last_superadmin').message).toMatch(/último/)
    expect(describeAdminUsersError('forbidden').message).toMatch(/permissão/)
    expect(describeAdminUsersError('actor_inactive').message).toMatch(/não/)
  })

  it('falls back to a generic message for internal', () => {
    const view = describeAdminUsersError('internal')
    expect(view.message).toMatch(/inesperado/i)
    expect(view.action).toBe('none')
  })
})
