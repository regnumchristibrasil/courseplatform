import { assertEquals } from '@std/assert';
import { SQLSTATE_TO_CODE } from './map-rpc-error.ts';

const MIGRATIONS = [
  '../../migrations/20261005130000_a19_admin_list_users.sql',
  '../../migrations/20261005140000_a20_admin_mutations.sql',
];

// `errcode = 'AD003', message = 'stale_target'` as raised by the RPCs.
const RAISE_PATTERN = /errcode\s*=\s*'([0-9A-Z]{5})',\s*message\s*=\s*'([a-z_]+)'/g;
// Header documentation lines: `--   stale_target    -> AD003`.
const HEADER_PATTERN = /^--\s+([a-z_]+)\s+->\s+([0-9A-Z]{5})/gm;

async function readMigration(relative: string): Promise<string> {
  return await Deno.readTextFile(new URL(relative, import.meta.url));
}

Deno.test('every errcode/message pair raised in a19/a20 matches SQLSTATE_TO_CODE', async () => {
  const seen = new Map<string, string>();
  for (const file of MIGRATIONS) {
    for (const [, sqlstate, code] of (await readMigration(file)).matchAll(RAISE_PATTERN)) {
      assertEquals(SQLSTATE_TO_CODE[sqlstate!], code, `${file}: ${sqlstate} -> ${code}`);
      seen.set(sqlstate!, code!);
    }
  }
  // Every mapped SQLSTATE is actually raised somewhere (no dead map entries).
  assertEquals([...seen.keys()].sort(), Object.keys(SQLSTATE_TO_CODE).sort());
});

Deno.test('documented header pairs in a19/a20 match SQLSTATE_TO_CODE', async () => {
  let documented = 0;
  for (const file of MIGRATIONS) {
    for (const [, code, sqlstate] of (await readMigration(file)).matchAll(HEADER_PATTERN)) {
      assertEquals(SQLSTATE_TO_CODE[sqlstate!], code, `${file}: header ${code} -> ${sqlstate}`);
      documented += 1;
    }
  }
  assertEquals(documented >= Object.keys(SQLSTATE_TO_CODE).length, true);
});
