import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCurrentAccess } from '../authz/currentAccessApi'
import { resolvePostLoginDestination } from './postLoginDestination'

vi.mock('../authz/currentAccessApi', () => ({ fetchCurrentAccess: vi.fn() }))
const client = {} as SupabaseClient

describe('resolvePostLoginDestination', () => {
  it('honors an explicit local destination for everyone, without hitting the API', async () => {
    await expect(resolvePostLoginDestination(client, '/admin/courses')).resolves.toBe('/admin/courses')
    expect(fetchCurrentAccess).not.toHaveBeenCalled()
  })

  it.each(['//evil.com', '/\\evil', 'https://evil.com', ''])('ignores unsafe destination %s', async (unsafe) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    await expect(resolvePostLoginDestination(client, unsafe)).resolves.toBe('/meus-cursos')
  })

  it('sends students to /meus-cursos by default', async () => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role: 'student', isActive: true })
    await expect(resolvePostLoginDestination(client, undefined)).resolves.toBe('/meus-cursos')
  })

  it.each(['tutor', 'admin', 'superadmin'] as const)('keeps the current default (/) for %s', async (role) => {
    vi.mocked(fetchCurrentAccess).mockResolvedValue({ role, isActive: true })
    await expect(resolvePostLoginDestination(client, undefined)).resolves.toBe('/')
  })

  it('falls back to / when the access lookup fails or is empty', async () => {
    vi.mocked(fetchCurrentAccess).mockRejectedValueOnce(new Error('boom'))
    await expect(resolvePostLoginDestination(client, undefined)).resolves.toBe('/')
    vi.mocked(fetchCurrentAccess).mockResolvedValueOnce(null)
    await expect(resolvePostLoginDestination(client, undefined)).resolves.toBe('/')
  })
})
