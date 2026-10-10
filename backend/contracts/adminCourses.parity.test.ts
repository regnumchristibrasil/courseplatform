import { assertEquals } from '@std/assert';

// Contract shared verbatim between frontend and backend (ticket #14). Fails
// the moment either copy drifts; edit both files together, never just one.

const FRONTEND_PATH = new URL('../../frontend/src/contracts/adminCourses.ts', import.meta.url);
const BACKEND_PATH = new URL('./adminCourses.ts', import.meta.url);

function normalize(source: string): string {
  return source.trim().replace(/\r\n/g, '\n');
}

Deno.test('backend contracts/adminCourses.ts stays byte-identical to frontend/src/contracts/adminCourses.ts', async () => {
  const [frontendSource, backendSource] = await Promise.all([
    Deno.readTextFile(FRONTEND_PATH),
    Deno.readTextFile(BACKEND_PATH),
  ]);

  assertEquals(
    normalize(backendSource),
    normalize(frontendSource),
    'backend/contracts/adminCourses.ts has drifted from frontend/src/contracts/adminCourses.ts -- ' +
      'edit both copies together',
  );
});
