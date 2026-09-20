import { assertEquals, assertRejects } from '@std/assert';
import { InvalidYouTubeReferenceError, YouTubeProvider } from './youtube-provider.ts';

const provider = new YouTubeProvider();

Deno.test('YouTubeProvider.playerKind is "youtube"', () => {
  assertEquals(provider.playerKind, 'youtube');
});

Deno.test('resolve() accepts a bare 11-character video id', async () => {
  const resolved = await provider.resolve('dQw4w9WgXcQ');
  assertEquals(resolved, { playerKind: 'youtube', videoId: 'dQw4w9WgXcQ', expiresAt: null });
});

Deno.test('resolve() extracts the id from a youtube.com/watch?v= URL', async () => {
  const resolved = await provider.resolve('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s');
  assertEquals(resolved.playerKind, 'youtube');
  if (resolved.playerKind === 'youtube') {
    assertEquals(resolved.videoId, 'dQw4w9WgXcQ');
    assertEquals(resolved.expiresAt, null);
  }
});

Deno.test('resolve() extracts the id from a bare youtube.com/watch?v= URL (no www, no scheme)', async () => {
  const resolved = await provider.resolve('youtube.com/watch?v=dQw4w9WgXcQ');
  if (resolved.playerKind === 'youtube') {
    assertEquals(resolved.videoId, 'dQw4w9WgXcQ');
  }
});

Deno.test('resolve() extracts the id from a youtu.be short URL', async () => {
  const resolved = await provider.resolve('https://youtu.be/dQw4w9WgXcQ?t=5');
  if (resolved.playerKind === 'youtube') {
    assertEquals(resolved.videoId, 'dQw4w9WgXcQ');
  }
});

Deno.test('resolve() extracts the id from an /embed/ URL', async () => {
  const resolved = await provider.resolve('https://www.youtube.com/embed/dQw4w9WgXcQ');
  if (resolved.playerKind === 'youtube') {
    assertEquals(resolved.videoId, 'dQw4w9WgXcQ');
  }
});

Deno.test('resolve() rejects an empty external ref', async () => {
  await assertRejects(() => provider.resolve(''), InvalidYouTubeReferenceError);
});

Deno.test('resolve() rejects a whitespace-only external ref', async () => {
  await assertRejects(() => provider.resolve('   '), InvalidYouTubeReferenceError);
});

Deno.test('resolve() rejects an unrelated URL', async () => {
  await assertRejects(
    () => provider.resolve('https://vimeo.com/12345'),
    InvalidYouTubeReferenceError,
  );
});

Deno.test('resolve() rejects a malformed id-like string (wrong length)', async () => {
  await assertRejects(() => provider.resolve('short'), InvalidYouTubeReferenceError);
});

Deno.test('resolve() rejects a string with characters outside the YouTube id alphabet', async () => {
  await assertRejects(() => provider.resolve('dQw4w9Wg$$$'), InvalidYouTubeReferenceError);
});
