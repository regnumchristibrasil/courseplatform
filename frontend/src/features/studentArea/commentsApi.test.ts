import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { COMMENT_PAGE_SIZE } from '../../contracts/studentArea'
import { createLessonComment, deleteLessonComment, listLessonComments, StudentAreaApiError } from './commentsApi'

function buildFakeClient(response: { data: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(response)
  const schema = vi.fn().mockReturnValue({ rpc })
  return { client: { schema } as unknown as SupabaseClient, schema, rpc }
}

function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `id-${n}`,
    parent_id: null,
    author_first_name: 'Maria',
    is_staff_author: false,
    body: `comentario ${n}`,
    created_at: `2026-01-01T00:00:${String(60 - n).padStart(2, '0')}Z`,
    is_own: false,
    is_deleted: false,
    can_delete: false,
    ...overrides,
  }
}

describe('listLessonComments', () => {
  it('calls app.list_lesson_comments without a cursor on the first page', async () => {
    const { client, schema, rpc } = buildFakeClient({ data: [row(1)], error: null })
    await listLessonComments(client, 'l1', null)
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('list_lesson_comments', {
      p_lesson_id: 'l1',
      p_cursor_created_at: null,
      p_cursor_id: null,
    })
  })

  it('sends the cursor and maps rows to camelCase', async () => {
    const { client, rpc } = buildFakeClient({
      data: [row(1, { is_staff_author: true, is_own: true })],
      error: null,
    })
    const page = await listLessonComments(client, 'l1', { createdAt: '2026-01-01T00:00:10Z', id: 'c-9' })
    expect(rpc).toHaveBeenCalledWith('list_lesson_comments', {
      p_lesson_id: 'l1',
      p_cursor_created_at: '2026-01-01T00:00:10Z',
      p_cursor_id: 'c-9',
    })
    expect(page.threads).toEqual([
      {
        root: {
          id: 'id-1',
          parentId: null,
          authorFirstName: 'Maria',
          isStaffAuthor: true,
          body: 'comentario 1',
          createdAt: '2026-01-01T00:00:59Z',
          isOwn: true,
          isDeleted: false,
          canDelete: false,
        },
        replies: [],
      },
    ])
    expect(page.nextCursor).toBeNull()
  })

  it('drops the sentinel row and points the cursor at the last visible comment', async () => {
    const rows = Array.from({ length: COMMENT_PAGE_SIZE + 1 }, (_, i) => row(i + 1))
    rows.push(row(900, { parent_id: `id-${COMMENT_PAGE_SIZE + 1}` }))
    const { client } = buildFakeClient({ data: rows, error: null })
    const page = await listLessonComments(client, 'l1', null)
    expect(page.threads).toHaveLength(COMMENT_PAGE_SIZE)
    expect(page.nextCursor).toEqual({ createdAt: rows[COMMENT_PAGE_SIZE - 1].created_at, id: `id-${COMMENT_PAGE_SIZE}` })
  })

  it('treats exactly a full page as the last one', async () => {
    const rows = Array.from({ length: COMMENT_PAGE_SIZE }, (_, i) => row(i + 1))
    const { client } = buildFakeClient({ data: rows, error: null })
    const page = await listLessonComments(client, 'l1', null)
    expect(page.threads).toHaveLength(COMMENT_PAGE_SIZE)
    expect(page.nextCursor).toBeNull()
  })

  it('groups replies under their root, keeping the server order', async () => {
    const rows = [row(1), row(2, { parent_id: 'id-1' }), row(3, { parent_id: 'id-1' }), row(4)]
    const { client } = buildFakeClient({ data: rows, error: null })
    const page = await listLessonComments(client, 'l1', null)
    expect(page.threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ['id-1', ['id-2', 'id-3']],
      ['id-4', []],
    ])
    expect(page.threads[0].replies[0].parentId).toBe('id-1')
  })

  it('ignores replies whose root is not on the page', async () => {
    const { client } = buildFakeClient({ data: [row(1), row(2, { parent_id: 'elsewhere' })], error: null })
    const page = await listLessonComments(client, 'l1', null)
    expect(page.threads).toHaveLength(1)
    expect(page.threads[0].replies).toEqual([])
  })

  it('does not count replies towards the page size', async () => {
    const roots = Array.from({ length: COMMENT_PAGE_SIZE }, (_, i) => row(i + 1))
    const replies = Array.from({ length: 5 }, (_, i) => row(100 + i, { parent_id: 'id-1' }))
    const { client } = buildFakeClient({ data: [roots[0], ...replies, ...roots.slice(1)], error: null })
    const page = await listLessonComments(client, 'l1', null)
    expect(page.threads).toHaveLength(COMMENT_PAGE_SIZE)
    expect(page.threads[0].replies).toHaveLength(5)
    expect(page.nextCursor).toBeNull()
  })

  it('maps a removed root', async () => {
    const { client } = buildFakeClient({
      data: [row(1, { is_deleted: true, author_first_name: '', body: '' }), row(2, { parent_id: 'id-1' })],
      error: null,
    })
    const page = await listLessonComments(client, 'l1', null)
    expect(page.threads[0].root).toMatchObject({ isDeleted: true, body: '' })
    expect(page.threads[0].replies).toHaveLength(1)
  })

  it('returns an empty page for zero rows or null data', async () => {
    const { client } = buildFakeClient({ data: null, error: null })
    await expect(listLessonComments(client, 'l1', null)).resolves.toEqual({ threads: [], nextCursor: null })
  })

  it('rejects a payload missing the new fields', async () => {
    const { is_deleted: _omit, ...incomplete } = row(1)
    const { client } = buildFakeClient({ data: [incomplete], error: null })
    await expect(listLessonComments(client, 'l1', null)).rejects.toThrow('Invalid lesson comments payload.')
  })

  it('rejects a malformed payload', async () => {
    const { client } = buildFakeClient({ data: [{ id: 1 }], error: null })
    await expect(listLessonComments(client, 'l1', null)).rejects.toThrow('Invalid lesson comments payload.')
  })

  it('maps HTTP 401 to a typed unauthorized error', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: '42501', message: 'x', hint: null }, status: 401 })
    await expect(listLessonComments(client, 'l1', null)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('throws a generic error for other failures', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: 'XX000', message: 'boom', hint: null }, status: 500 })
    await expect(listLessonComments(client, 'l1', null)).rejects.toThrow('Failed to load lesson comments: boom')
  })
})

describe('createLessonComment', () => {
  it('sends the parent id when replying', async () => {
    const { client, rpc } = buildFakeClient({ data: [row(2, { parent_id: 'id-1', is_own: true })], error: null })
    const comment = await createLessonComment(client, 'l1', 'oi', 'id-1')
    expect(rpc).toHaveBeenCalledWith('create_lesson_comment', { p_lesson_id: 'l1', p_body: 'oi', p_parent_id: 'id-1' })
    expect(comment.parentId).toBe('id-1')
  })

  it('calls app.create_lesson_comment and returns the created comment', async () => {
    const { client, rpc } = buildFakeClient({ data: [row(1, { is_own: true })], error: null })
    const comment = await createLessonComment(client, 'l1', 'oi')
    expect(rpc).toHaveBeenCalledWith('create_lesson_comment', { p_lesson_id: 'l1', p_body: 'oi' })
    expect(comment).toMatchObject({ id: 'id-1', isOwn: true })
  })

  it.each(['rate_limited', 'forbidden', 'invalid_input', 'unauthorized'] as const)(
    'maps the %s error code from the hint',
    async (code) => {
      const { client } = buildFakeClient({ data: null, error: { code: 'P0001', message: code, hint: code }, status: 400 })
      const error = await createLessonComment(client, 'l1', 'oi').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StudentAreaApiError)
      expect(error).toMatchObject({ code })
    },
  )

  it('maps a bare 42501 to forbidden', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: '42501', message: 'denied', hint: null }, status: 403 })
    await expect(createLessonComment(client, 'l1', 'oi')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('maps HTTP 401 to unauthorized', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: 'PGRST301', message: 'jwt', hint: null }, status: 401 })
    await expect(createLessonComment(client, 'l1', 'oi')).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('throws a generic error for unknown failures', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: 'XX000', message: 'boom', hint: null }, status: 500 })
    await expect(createLessonComment(client, 'l1', 'oi')).rejects.toThrow('Failed to create lesson comment: boom')
  })

  it('throws when the server returns no row', async () => {
    const { client } = buildFakeClient({ data: [], error: null })
    await expect(createLessonComment(client, 'l1', 'oi')).rejects.toThrow('Invalid lesson comments payload.')
  })
})

describe('deleteLessonComment', () => {
  it('calls app.delete_lesson_comment with the comment id', async () => {
    const { client, schema, rpc } = buildFakeClient({ data: null, error: null })
    await expect(deleteLessonComment(client, 'id-1')).resolves.toBeUndefined()
    expect(schema).toHaveBeenCalledWith('app')
    expect(rpc).toHaveBeenCalledWith('delete_lesson_comment', { p_comment_id: 'id-1' })
  })

  it.each(['forbidden', 'invalid_input', 'unauthorized'] as const)('maps the %s error code from the hint', async (code) => {
    const { client } = buildFakeClient({ data: null, error: { code: '42501', message: code, hint: code }, status: 403 })
    await expect(deleteLessonComment(client, 'id-1')).rejects.toMatchObject({ code })
  })

  it('throws a generic error for unknown failures', async () => {
    const { client } = buildFakeClient({ data: null, error: { code: 'XX000', message: 'boom', hint: null }, status: 500 })
    await expect(deleteLessonComment(client, 'id-1')).rejects.toThrow('Failed to delete lesson comment: boom')
  })
})
