import { assertEquals } from '@std/assert';
import { ADMIN_USERS_ERROR_STATUS } from '../../../contracts/adminUsers.ts';
import { mapRpcError } from './map-rpc-error.ts';

const BY_CODE = [
  ['forbidden', '42501'],
  ['invalid_input', '22023'],
  ['not_found', 'P0002'],
  ['self_target', 'AD001'],
  ['actor_inactive', 'AD002'],
  ['stale_target', 'AD003'],
  ['last_superadmin', 'AD004'],
] as const;

Deno.test('mapRpcError maps by stable message', () => {
  for (const [code, sqlstate] of BY_CODE) {
    const mapped = mapRpcError({ message: code, code: sqlstate, hint: code });
    assertEquals(mapped?.code, code);
    assertEquals(mapped?.status, ADMIN_USERS_ERROR_STATUS[code]);
  }
});

Deno.test('mapRpcError falls back to SQLSTATE when message is not a code', () => {
  for (const [code, sqlstate] of BY_CODE) {
    assertEquals(
      mapRpcError({ message: 'whatever', code: sqlstate })?.code,
      code,
    );
  }
});

Deno.test('mapRpcError returns null for unknown errors', () => {
  assertEquals(mapRpcError({ message: 'boom', code: 'XX000' }), null);
  assertEquals(mapRpcError({ message: 'boom' }), null);
});

Deno.test('mapRpcError never maps to auth_sync_failed from the database', () => {
  assertEquals(
    mapRpcError({ message: 'auth_sync_failed', code: 'XX000' }),
    null,
  );
});
