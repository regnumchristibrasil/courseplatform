import type { ResolvedVideo } from '../../contracts/video'
import { type PlayerOptions, resolvePlayerElement } from './playerRegistry'

export interface LessonPlayerProps extends PlayerOptions {
  readonly video: ResolvedVideo
}

// Player-registry component: switches on `playerKind` so swapping the
// video provider (YouTube -> Panda Video) only touches the registry, never
// the pages that embed this component.
export function LessonPlayer({ video, onPlay }: LessonPlayerProps) {
  return resolvePlayerElement(video, { onPlay })
}
