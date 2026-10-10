import { assertEquals } from '@std/assert';
import { ADMIN_COURSES_ERROR_STATUS } from '../../../contracts/adminCourses.ts';
import { mapRpcError, SQLSTATE_TO_CODE } from './map-rpc-error.ts';

Deno.test('maps by message first, then by SQLSTATE', () => {
  assertEquals(mapRpcError({ message: 'stale_target' }), { code: 'stale_target', status: 409 });
  assertEquals(mapRpcError({ message: 'x', code: '42501' }), { code: 'forbidden', status: 403 });
  assertEquals(mapRpcError({ code: 'CR001' }), { code: 'stale_target', status: 409 });
});

Deno.test('unknown errors are null (caller answers 500)', () => {
  assertEquals(mapRpcError({ message: 'boom', code: '23505' }), null);
  assertEquals(mapRpcError({}), null);
});

Deno.test('statuses come from the shared contract', () => {
  for (const code of Object.values(SQLSTATE_TO_CODE)) {
    assertEquals(mapRpcError({ message: code })?.status, ADMIN_COURSES_ERROR_STATUS[code]);
  }
});

Deno.test('every errcode/message pair raised in a30 matches SQLSTATE_TO_CODE', async () => {
  const sql = await Deno.readTextFile(
    new URL('../../migrations/20261009170000_a30_staff_course_write.sql', import.meta.url),
  );
  const seen = new Map<string, string>();
  for (
    const [, sqlstate, code] of sql.matchAll(
      /errcode\s*=\s*'([0-9A-Z]{5})',\s*message\s*=\s*'([a-z_]+)'/g,
    )
  ) {
    assertEquals(SQLSTATE_TO_CODE[sqlstate!], code, `${sqlstate} -> ${code}`);
    seen.set(sqlstate!, code!);
  }
  assertEquals([...seen.keys()].sort(), Object.keys(SQLSTATE_TO_CODE).sort());
});
