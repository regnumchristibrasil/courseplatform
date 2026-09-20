// YouTube phase `VideoProvider` -- real implementation. Resolves a stored
// `external_ref` (bare video id or a full YouTube URL, both accepted since
// what actually lands in `app_private.lesson_assets.external_ref` at
// authoring time is a judgment call left to whoever curates lessons) to the
// frozen `ResolvedVideo` discriminated union.
//
// Accepted risk per prompt_course_platform.md: YouTube unlisted has no
// signed URLs/expiry/revocation -- `expiresAt` is always `null` here. This
// provider stops non-enrolled access and catalog scraping by never being
// called except server-side after an enrollment check; it does not stop an
// enrolled user from sharing a resolved link.

import type { ResolvedVideo } from '../../../../contracts/video.ts';
import type { VideoProvider } from './types.ts';

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// Matches the id segment out of watch?v=, youtu.be/, and /embed/ URL forms,
// tolerating an optional scheme/www and trailing query/hash params.
const YOUTUBE_URL_ID_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$/;

export class InvalidYouTubeReferenceError extends Error {
  constructor(externalRef: string) {
    super(`Could not extract a YouTube video id from external ref: "${externalRef}"`);
    this.name = 'InvalidYouTubeReferenceError';
  }
}

function extractVideoId(externalRef: string): string {
  const trimmed = externalRef.trim();
  if (trimmed.length === 0) {
    throw new InvalidYouTubeReferenceError(externalRef);
  }
  if (YOUTUBE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const match = YOUTUBE_URL_ID_PATTERN.exec(trimmed);
  if (match?.[1]) {
    return match[1];
  }
  throw new InvalidYouTubeReferenceError(externalRef);
}

export class YouTubeProvider implements VideoProvider {
  readonly playerKind = 'youtube' as const;

  // deno-lint-ignore require-await
  async resolve(externalRef: string): Promise<ResolvedVideo> {
    const videoId = extractVideoId(externalRef);
    return { playerKind: 'youtube', videoId, expiresAt: null };
  }
}
