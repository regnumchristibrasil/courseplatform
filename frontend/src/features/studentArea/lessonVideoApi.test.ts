import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { fetchLessonVideo } from './lessonVideoApi'

function buildClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result)
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke }
}

function httpError(status: number, body: unknown) {
  return { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status }) }
}

describe('fetchLessonVideo', () => {
  it('posts the lesson id to video-resolve and returns a youtube video', async () => {
    const { client, invoke } = buildClient({
      data: { lessonId: 'l1', video: { playerKind: 'youtube', videoId: 'abc', expiresAt: null } },
      error: null,
    })
    await expect(fetchLessonVideo(client, 'l1')).resolves.toEqual({ playerKind: 'youtube', videoId: 'abc', expiresAt: null })
    expect(invoke).toHaveBeenCalledWith('video-resolve', { body: { lessonId: 'l1' } })
  })

  it('returns a panda video', async () => {
    const video = { playerKind: 'panda', embedUrl: 'https://p/x', expiresAt: '2027-01-01T00:00:00Z' }
    const { client } = buildClient({ data: { lessonId: 'l1', video }, error: null })
    await expect(fetchLessonVideo(client, 'l1')).resolves.toEqual(video)
  })

  it('returns null when the caller is not entitled (403 not_entitled)', async () => {
    const { client } = buildClient({ data: null, error: httpError(403, { error: { code: 'not_entitled', message: 'x' } }) })
    await expect(fetchLessonVideo(client, 'l1')).resolves.toBeNull()
  })

  it('throws on other failures', async () => {
    const { client } = buildClient({ data: null, error: httpError(500, { error: { code: 'internal_error', message: 'x' } }) })
    await expect(fetchLessonVideo(client, 'l1')).rejects.toThrow(/failed to load lesson video/i)
  })

  it('rejects a malformed payload', async () => {
    const { client } = buildClient({ data: { lessonId: 'l1', video: { playerKind: 'vimeo' } }, error: null })
    await expect(fetchLessonVideo(client, 'l1')).rejects.toThrow(/invalid lesson video payload/i)
  })
})
