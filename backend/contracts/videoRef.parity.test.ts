import { assertEquals } from '@std/assert';
import { VIDEO_REF_CASES } from './videoRef.ts';

// Video reference parsing exists in three places: this contract (backend copy),
// the frontend copy, and app_private.parse_video_ref in SQL (ticket #19).
// Fails the moment any of them drifts; edit all together, never just one.

const FRONTEND_PATH = new URL('../../frontend/src/contracts/videoRef.ts', import.meta.url);
const BACKEND_PATH = new URL('./videoRef.ts', import.meta.url);
const SQL_TEST_PATH = new URL('../supabase/tests/a33_staff_lesson_video_test.sql', import.meta.url);
const SQL_CASES_PATTERN = /\$video_ref_cases\$(.*?)\$video_ref_cases\$/s;

function normalize(source: string): string {
  return source.trim().replace(/\r\n/g, '\n');
}

Deno.test('backend contracts/videoRef.ts stays byte-identical to frontend/src/contracts/videoRef.ts', async () => {
  const [frontendSource, backendSource] = await Promise.all([
    Deno.readTextFile(FRONTEND_PATH),
    Deno.readTextFile(BACKEND_PATH),
  ]);

  assertEquals(
    normalize(backendSource),
    normalize(frontendSource),
    'backend/contracts/videoRef.ts has drifted from frontend/src/contracts/videoRef.ts -- ' +
      'edit both copies together',
  );
});

Deno.test('pgTAP test embeds exactly the VIDEO_REF_CASES table', async () => {
  const sql = await Deno.readTextFile(SQL_TEST_PATH);
  const match = SQL_CASES_PATTERN.exec(sql);
  if (!match?.[1]) throw new Error('a33 test is missing the $video_ref_cases$ literal');

  assertEquals(
    JSON.parse(match[1]),
    VIDEO_REF_CASES,
    'a33_staff_lesson_video_test.sql drifted from VIDEO_REF_CASES -- regenerate the literal',
  );
});
