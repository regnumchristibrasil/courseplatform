import type { ReactElement } from 'react'
import type { ResolvedVideo } from '../../contracts/video'
import { PandaPlayerStub } from './PandaPlayerStub'
import { YouTubePlayer } from './YouTubePlayer'

export interface PlayerOptions {
  // Called once playback actually starts. Intentionally optional and
  // analytics-agnostic — LessonPlayer stays presentational; the page that
  // embeds it (out of scope for this batch) is what wires this to
  // `capture('video_played', ...)`.
  readonly onPlay?: () => void
}

// Never let an unrecognized playerKind render blank or fall through
// silently — throw loudly so a bad backend contract or a provider added
// without frontend support gets caught immediately, not as a support
// ticket about a blank video page.
function assertNever(value: never): never {
  throw new Error(
    `LessonPlayer: unhandled playerKind "${(value as { playerKind?: unknown }).playerKind}".`,
  )
}

export function resolvePlayerElement(video: ResolvedVideo, options: PlayerOptions = {}): ReactElement {
  switch (video.playerKind) {
    case 'youtube':
      return <YouTubePlayer videoId={video.videoId} onPlay={options.onPlay} />
    case 'panda':
      // Deliberate stub: Panda Video is production-phase work (signed,
      // expiring URLs need a dedicated SDK/player). This branch exists so
      // the discriminated union stays exhaustive from day one, per the
      // spec's VideoProvider swap requirement — it is intentionally
      // unfinished, not accidentally unhandled.
      return <PandaPlayerStub embedUrl={video.embedUrl} expiresAt={video.expiresAt} />
    default:
      return assertNever(video)
  }
}
