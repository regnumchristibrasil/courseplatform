// Panda Video `VideoProvider` -- deliberate, explicit stub.
//
// Production-phase work per prompt_course_platform.md, out of scope for the
// current MVP pass. This must fail loudly if ever invoked -- silently
// returning empty/wrong data that *looks* like a resolved video would be
// far worse than an obvious error, since it would surface as a broken
// player for a paying, enrolled user instead of a caught bug.

import type { ResolvedVideo } from '../../../../contracts/video.ts';
import type { VideoProvider } from './types.ts';

export class PandaProviderNotImplementedError extends Error {
  constructor() {
    super(
      'PandaProvider.resolve() is not implemented yet -- Panda Video is production-phase work, ' +
        'not part of the current MVP. Do not route VIDEO_PROVIDER=panda traffic here until the ' +
        'YouTube-to-Panda migration (see docs/runbook-youtube-to-panda.md) lands.',
    );
    this.name = 'PandaProviderNotImplementedError';
  }
}

export class PandaProvider implements VideoProvider {
  readonly playerKind = 'panda' as const;

  // deno-lint-ignore require-await
  async resolve(_externalRef: string): Promise<ResolvedVideo> {
    throw new PandaProviderNotImplementedError();
  }
}
