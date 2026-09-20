export type PlayerKind = 'youtube' | 'panda'

export type ResolvedVideo =
  | { playerKind: 'youtube'; videoId: string; expiresAt: null }
  | { playerKind: 'panda'; embedUrl: string; expiresAt: string }
