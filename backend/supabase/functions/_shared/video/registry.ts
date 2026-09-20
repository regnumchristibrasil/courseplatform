// Small VideoProvider registry/factory keyed by `playerKind`. Swapping the
// active video provider for a given lesson is a per-row `is_active`
// migration in `app_private.lesson_assets` (see the plan doc) -- this
// registry is what lets `video-resolve` route to the right provider
// implementation once it has that row's `provider` column.

import type { PlayerKind, ResolvedVideo } from '../../../../contracts/video.ts';
import { PandaProvider } from './panda-provider.ts';
import type { VideoProvider } from './types.ts';
import { YouTubeProvider } from './youtube-provider.ts';

export type VideoProviderRegistry = Readonly<Record<PlayerKind, VideoProvider>>;

export function createVideoProviderRegistry(): VideoProviderRegistry {
  return {
    youtube: new YouTubeProvider(),
    panda: new PandaProvider(),
  };
}

export class UnknownPlayerKindError extends Error {
  constructor(playerKind: string) {
    super(`No VideoProvider registered for playerKind: "${playerKind}"`);
    this.name = 'UnknownPlayerKindError';
  }
}

export function getVideoProvider(
  registry: VideoProviderRegistry,
  playerKind: PlayerKind,
): VideoProvider {
  const provider = registry[playerKind];
  if (!provider) {
    throw new UnknownPlayerKindError(playerKind);
  }
  return provider;
}

export function resolveVideo(
  registry: VideoProviderRegistry,
  playerKind: PlayerKind,
  externalRef: string,
): Promise<ResolvedVideo> {
  return getVideoProvider(registry, playerKind).resolve(externalRef);
}
