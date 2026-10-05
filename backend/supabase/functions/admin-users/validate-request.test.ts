import { assertEquals, assertThrows } from '@std/assert';
import { InvalidSetActiveRequestError, validateSetActiveRequest } from './validate-request.ts';

const USER_ID = '3f6c1b2e-8a4d-4c1e-9b7a-2d5e6f708192';
const valid = {
  action: 'set_active',
  userId: USER_ID,
  active: false,
  expectedActive: true,
};

Deno.test('validateSetActiveRequest accepts a minimal valid body', () => {
  assertEquals(validateSetActiveRequest(valid), {
    userId: USER_ID,
    active: false,
    expectedActive: true,
    reason: undefined,
  });
});

Deno.test('validateSetActiveRequest keeps a reason up to 500 chars', () => {
  const reason = 'x'.repeat(500);
  assertEquals(validateSetActiveRequest({ ...valid, reason }).reason, reason);
});

Deno.test('validateSetActiveRequest rejects invalid bodies', () => {
  const cases: Record<string, unknown> = {
    'null body': null,
    'array body': [],
    'string body': 'x',
    'missing action': { userId: USER_ID, active: true, expectedActive: false },
    'wrong action': { ...valid, action: 'set_role' },
    'missing userId': {
      action: 'set_active',
      active: true,
      expectedActive: false,
    },
    'missing active': {
      action: 'set_active',
      userId: USER_ID,
      expectedActive: false,
    },
    'missing expectedActive': {
      action: 'set_active',
      userId: USER_ID,
      active: true,
    },
    'userId not a uuid': { ...valid, userId: 'not-a-uuid' },
    'userId number': { ...valid, userId: 42 },
    'active string': { ...valid, active: 'true' },
    'expectedActive number': { ...valid, expectedActive: 1 },
    'reason number': { ...valid, reason: 5 },
    'reason 501 chars': { ...valid, reason: 'x'.repeat(501) },
    'unknown field': { ...valid, actorId: USER_ID },
    'unknown field role': { ...valid, role: 'admin' },
  };
  for (const [name, body] of Object.entries(cases)) {
    assertThrows(
      () => validateSetActiveRequest(body),
      InvalidSetActiveRequestError,
      undefined,
      name,
    );
  }
});

Deno.test('validateSetActiveRequest counts reason length in code points, not UTF-16 units', () => {
  const reason = '\u{1F600}'.repeat(500); // 500 code points, 1000 UTF-16 units
  assertEquals(validateSetActiveRequest({ ...valid, reason }).reason, reason);
  assertThrows(
    () => validateSetActiveRequest({ ...valid, reason: '\u{1F600}'.repeat(501) }),
    InvalidSetActiveRequestError,
  );
});

Deno.test('validateSetActiveRequest normalizes an empty reason to undefined', () => {
  assertEquals(validateSetActiveRequest({ ...valid, reason: '' }).reason, undefined);
});

Deno.test('validateSetActiveRequest unknown-fields message is static and never echoes caller keys', () => {
  const error = assertThrows(
    () => validateSetActiveRequest({ ...valid, '<script>evil</script>': 1 }),
    InvalidSetActiveRequestError,
  );
  assertEquals(error.message, 'Unknown fields in request body');
});
