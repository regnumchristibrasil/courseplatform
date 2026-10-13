import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedVideo } from '../../contracts/video'
import { AdminUsersApiError } from '../admin/users/api'

const VIDEO_RESOLVE_FUNCTION = 'video-resolve'
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const INVALID_PAYLOAD = 'Invalid lesson video payload.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseVideo(raw: unknown): ResolvedVideo {
  if (isRecord(raw) && raw.playerKind === 'youtube' && typeof raw.videoId === 'string') {
    return { playerKind: 'youtube', videoId: raw.videoId, expiresAt: null }
  }
  if (isRecord(raw) && raw.playerKind === 'panda' && typeof raw.embedUrl === 'string' && typeof raw.expiresAt === 'string') {
    return { playerKind: 'panda', embedUrl: raw.embedUrl, expiresAt: raw.expiresAt }
  }
  throw new Error(INVALID_PAYLOAD)
}

// null = sem direito de reproduzir (403 not_entitled); a tela mostra "vídeo
// indisponível" sem distinguir os motivos. A autorização real fica na função,
// que roda com o JWT do chamador (get_playable_ref).
export async function fetchLessonVideo(client: SupabaseClient, lessonId: string): Promise<ResolvedVideo | null> {
  const { data, error } = await client.functions.invoke(VIDEO_RESOLVE_FUNCTION, { body: { lessonId } })

  if (error) {
    const status = (error as { context?: unknown }).context instanceof Response ? (error as { context: Response }).context.status : undefined
    if (status === HTTP_UNAUTHORIZED) {
      throw new AdminUsersApiError('unauthorized', 'Sua sessão expirou. Entre novamente.')
    }
    if (status === HTTP_FORBIDDEN) return null
    throw new Error(`Failed to load lesson video: ${error.message}`)
  }

  if (!isRecord(data)) throw new Error(INVALID_PAYLOAD)
  return parseVideo(data.video)
}
