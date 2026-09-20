// `VideoProvider` -- not part of the frozen contracts block in
// prompt_course_platform.md (only `ResolvedVideo`/`PlayerKind` are frozen
// there), but designed to mirror `PaymentProvider`'s shape/conventions for
// consistency across the two swappable-adapter interfaces this repo has.

import type { PlayerKind, ResolvedVideo } from '../../../../contracts/video.ts';

export interface VideoProvider {
  readonly playerKind: PlayerKind;
  // `externalRef` is whatever `app_private.lesson_assets.external_ref`
  // stores for this provider (e.g. a YouTube video id/URL, a Panda video
  // id) -- resolution is per-provider, the caller never interprets it.
  resolve(externalRef: string): Promise<ResolvedVideo>;
}

const PLAYER_KINDS: readonly PlayerKind[] = ['youtube', 'panda'];

// Runtime boundary check for `playerKind` values read from the database
// (e.g. `app_private.lesson_assets.provider`) -- that data is external
// input and must be validated, not trusted as already matching the
// `PlayerKind` union just because TypeScript says so.
export function isPlayerKind(value: string): value is PlayerKind {
  return (PLAYER_KINDS as readonly string[]).includes(value);
}
