import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CandidateEmailsLookupError, fetchCandidateEmails } from './candidates.ts';
import { createFakeOutboxDrainSupabase } from './fakes.ts';

Deno.test('fetchCandidateEmails maps rows into CandidateEmail, defaulting a null payload to {}', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    candidatesResult: {
      data: [
        {
          id: 'row-1',
          template: 'welcome',
          to_email: 'a@example.com',
          payload: { user_id: 'user-1' },
          attempts: 0,
        },
        {
          id: 'row-2',
          template: 'purchase_confirmation',
          to_email: 'b@example.com',
          payload: null,
          attempts: 2,
        },
      ],
      error: null,
    },
  });

  const result = await fetchCandidateEmails(
    client as unknown as SupabaseClient,
    50,
  );

  assertEquals(result, [
    {
      id: 'row-1',
      template: 'welcome',
      toEmail: 'a@example.com',
      payload: { user_id: 'user-1' },
      attempts: 0,
    },
    {
      id: 'row-2',
      template: 'purchase_confirmation',
      toEmail: 'b@example.com',
      payload: {},
      attempts: 2,
    },
  ]);
});

Deno.test('fetchCandidateEmails returns an empty array when there is no data', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    candidatesResult: { data: null, error: null },
  });
  const result = await fetchCandidateEmails(
    client as unknown as SupabaseClient,
    50,
  );
  assertEquals(result, []);
});

Deno.test('fetchCandidateEmails throws CandidateEmailsLookupError when the query returns an error', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    candidatesResult: { data: null, error: { message: 'db exploded' } },
  });
  await assertRejects(
    () => fetchCandidateEmails(client as unknown as SupabaseClient, 50),
    CandidateEmailsLookupError,
  );
});

Deno.test('fetchCandidateEmails propagates an unexpected throw from the query', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    candidatesThrows: new Error('network down'),
  });
  await assertRejects(() => fetchCandidateEmails(client as unknown as SupabaseClient, 50));
});
