import { assertEquals } from '@std/assert';

// `ResolvedVideo` is a frozen contract shared verbatim between frontend and
// backend (see prompt_course_platform.md, "Video hosting" section). This
// test fails the moment either copy drifts from the other, which is the
// intended tripwire -- update both files together, never just one.

const FRONTEND_PATH = new URL('../../frontend/src/contracts/video.ts', import.meta.url);
const BACKEND_PATH = new URL('./video.ts', import.meta.url);

function normalize(source: string): string {
  return source.trim().replace(/\r\n/g, '\n');
}

Deno.test('backend contracts/video.ts stays byte-identical to frontend/src/contracts/video.ts', async () => {
  const [frontendSource, backendSource] = await Promise.all([
    Deno.readTextFile(FRONTEND_PATH),
    Deno.readTextFile(BACKEND_PATH),
  ]);

  assertEquals(
    normalize(backendSource),
    normalize(frontendSource),
    'backend/contracts/video.ts has drifted from frontend/src/contracts/video.ts -- ' +
      'ResolvedVideo is a frozen contract, edit both copies together',
  );
});
