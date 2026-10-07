import { applyGeneratedBlock, MATRIX_TEST_PATH } from './permission_matrix.ts';

const current = await Deno.readTextFile(MATRIX_TEST_PATH);
await Deno.writeTextFile(MATRIX_TEST_PATH, applyGeneratedBlock(current));
console.log(`updated ${MATRIX_TEST_PATH}`);
