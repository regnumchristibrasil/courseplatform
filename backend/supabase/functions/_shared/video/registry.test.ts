import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  createVideoProviderRegistry,
  getVideoProvider,
  resolveVideo,
  UnknownPlayerKindError,
} from './registry.ts';
import { isPlayerKind } from './types.ts';
import { PandaProviderNotImplementedError } from './panda-provider.ts';

Deno.test('createVideoProviderRegistry registers both youtube and panda', () => {
  const registry = createVideoProviderRegistry();
  assertEquals(registry.youtube.playerKind, 'youtube');
  assertEquals(registry.panda.playerKind, 'panda');
});

Deno.test('getVideoProvider returns the youtube provider for playerKind "youtube"', () => {
  const registry = createVideoProviderRegistry();
  const provider = getVideoProvider(registry, 'youtube');
  assertEquals(provider.playerKind, 'youtube');
});

Deno.test('getVideoProvider throws UnknownPlayerKindError for a runtime-invalid kind', () => {
  const registry = createVideoProviderRegistry();
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => getVideoProvider(registry, 'vimeo' as any),
    UnknownPlayerKindError,
  );
});

Deno.test('resolveVideo delegates to the youtube provider and returns a ResolvedVideo', async () => {
  const registry = createVideoProviderRegistry();
  const resolved = await resolveVideo(registry, 'youtube', 'dQw4w9WgXcQ');
  assertEquals(resolved, { playerKind: 'youtube', videoId: 'dQw4w9WgXcQ', expiresAt: null });
});

Deno.test('resolveVideo delegates to the panda provider, which throws not-implemented', async () => {
  const registry = createVideoProviderRegistry();
  await assertRejects(
    () => resolveVideo(registry, 'panda', 'some-ref'),
    PandaProviderNotImplementedError,
  );
});

Deno.test('isPlayerKind validates untrusted strings at the system boundary', () => {
  assertEquals(isPlayerKind('youtube'), true);
  assertEquals(isPlayerKind('panda'), true);
  assertEquals(isPlayerKind('vimeo'), false);
  assertEquals(isPlayerKind(''), false);
});
