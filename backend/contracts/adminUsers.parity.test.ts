import { assertEquals } from '@std/assert';

// Contract shared verbatim between frontend and backend (admin user
// management plan, task 2). Fails the moment either copy drifts; edit both
// files together, never just one.

const FRONTEND_PATH = new URL('../../frontend/src/contracts/adminUsers.ts', import.meta.url);
const BACKEND_PATH = new URL('./adminUsers.ts', import.meta.url);

function normalize(source: string): string {
  return source.trim().replace(/\r\n/g, '\n');
}

Deno.test('backend contracts/adminUsers.ts stays byte-identical to frontend/src/contracts/adminUsers.ts', async () => {
  const [frontendSource, backendSource] = await Promise.all([
    Deno.readTextFile(FRONTEND_PATH),
    Deno.readTextFile(BACKEND_PATH),
  ]);

  assertEquals(
    normalize(backendSource),
    normalize(frontendSource),
    'backend/contracts/adminUsers.ts has drifted from frontend/src/contracts/adminUsers.ts -- ' +
      'edit both copies together',
  );
});
