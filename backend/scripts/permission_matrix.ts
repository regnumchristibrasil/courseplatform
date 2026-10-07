// Gera o bloco de linhas esperadas da matriz de permissao no teste pgTAP a20
// a partir de PERMISSION_MATRIX (contrato). O SQL nao importa TypeScript, entao
// o bloco entre marcadores e regenerado por `deno task gen:matrix` e um teste
// Deno falha se o bloco versionado divergir da saida do gerador.

import { PERMISSION_MATRIX } from '../contracts/adminUsers.ts';

export const MATRIX_TEST_PATH = 'supabase/tests/a20_admin_mutations_test.sql';
export const BEGIN_MARKER = '-- BEGIN GENERATED permission_matrix (deno task gen:matrix)';
export const END_MARKER = '-- END GENERATED permission_matrix';

export function renderMatrixBlock(): string {
  const values = PERMISSION_MATRIX.map((row) =>
    `  ('${row.actor}', '${row.target}', '${row.action}', ${
      row.newRole === null ? 'NULL' : `'${row.newRole}'`
    }, ${row.allowed})`
  ).join(',\n');
  return [
    BEGIN_MARKER,
    'CREATE TEMP TABLE matrix_expected (',
    '  actor text, target text, action text, new_role text, allowed boolean',
    ');',
    'INSERT INTO matrix_expected VALUES',
    `${values};`,
    END_MARKER,
  ].join('\n');
}

export function applyGeneratedBlock(content: string): string {
  const start = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (start === -1 || endIdx === -1 || endIdx < start) {
    throw new Error('generated block markers not found in ' + MATRIX_TEST_PATH);
  }
  return content.slice(0, start) + renderMatrixBlock() + content.slice(endIdx + END_MARKER.length);
}
