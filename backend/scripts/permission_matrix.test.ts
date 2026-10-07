import { assertEquals } from '@std/assert';
import { PERMISSION_MATRIX } from '../contracts/adminUsers.ts';
import { applyGeneratedBlock, MATRIX_TEST_PATH, renderMatrixBlock } from './permission_matrix.ts';

Deno.test('generated block has one VALUES row per contract matrix row', () => {
  const block = renderMatrixBlock();
  const rows = block.split('\n').filter((line) => line.trimStart().startsWith("('"));
  assertEquals(rows.length, PERMISSION_MATRIX.length);
});

Deno.test('checked-in a20 test block equals generator output (run: deno task gen:matrix)', async () => {
  const current = await Deno.readTextFile(MATRIX_TEST_PATH);
  assertEquals(
    applyGeneratedBlock(current),
    current,
    'permission matrix block in a20 test is stale; run `deno task gen:matrix`',
  );
});

Deno.test('applyGeneratedBlock fails loudly without markers', () => {
  let threw = false;
  try {
    applyGeneratedBlock('no markers here');
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
