import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateEmail } from './candidates.ts';
import { resolveTemplateData, TemplateResolutionError } from './resolve-template.ts';
import { createFakeOutboxDrainSupabase } from './fakes.ts';

function welcomeCandidate(
  overrides: Partial<CandidateEmail> = {},
): CandidateEmail {
  return {
    id: 'row-1',
    template: 'welcome',
    toEmail: 'a@example.com',
    payload: { user_id: 'user-1' },
    attempts: 0,
    ...overrides,
  };
}

function purchaseConfirmationCandidate(
  overrides: Partial<CandidateEmail> = {},
): CandidateEmail {
  return {
    id: 'row-2',
    template: 'purchase_confirmation',
    toEmail: 'b@example.com',
    payload: {
      order_id: 'order-1',
      course_id: 'course-1',
      enrollment_id: 'enrollment-1',
    },
    attempts: 0,
    ...overrides,
  };
}

Deno.test('resolveTemplateData resolves a welcome row from the users lookup', async () => {
  const { client, usersCalls } = createFakeOutboxDrainSupabase({
    usersById: {
      'user-1': { data: { full_name: 'Maria Silva' }, error: null },
    },
  });

  const result = await resolveTemplateData(
    client as unknown as SupabaseClient,
    welcomeCandidate(),
  );

  assertEquals(result, {
    template: 'welcome',
    data: { toEmail: 'a@example.com', userFullName: 'Maria Silva' },
  });
  assertEquals(usersCalls, ['user-1']);
});

Deno.test('resolveTemplateData resolves a welcome row with a null full_name', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    usersById: { 'user-1': { data: { full_name: null }, error: null } },
  });

  const result = await resolveTemplateData(
    client as unknown as SupabaseClient,
    welcomeCandidate(),
  );

  assertEquals(result, {
    template: 'welcome',
    data: { toEmail: 'a@example.com', userFullName: null },
  });
});

Deno.test('resolveTemplateData throws when the welcome payload has no user_id', async () => {
  const { client } = createFakeOutboxDrainSupabase();
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        welcomeCandidate({ payload: {} }),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws when the user lookup errors', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    usersById: { 'user-1': { data: null, error: { message: 'db exploded' } } },
  });
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        welcomeCandidate(),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws when the user lookup finds no row', async () => {
  const { client } = createFakeOutboxDrainSupabase({ usersById: {} });
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        welcomeCandidate(),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData resolves a purchase_confirmation row from the courses and orders lookups, using the order amount (not the course price)', async () => {
  const { client, coursesCalls, ordersCalls } = createFakeOutboxDrainSupabase({
    coursesById: {
      'course-1': { data: { title: 'Curso de TypeScript' }, error: null },
    },
    ordersById: {
      'order-1': { data: { amount_cents: 9900, currency: 'BRL' }, error: null },
    },
  });

  const result = await resolveTemplateData(
    client as unknown as SupabaseClient,
    purchaseConfirmationCandidate(),
  );

  assertEquals(result, {
    template: 'purchase_confirmation',
    data: {
      toEmail: 'b@example.com',
      courseTitle: 'Curso de TypeScript',
      amountCents: 9900,
      currency: 'BRL',
    },
  });
  assertEquals(coursesCalls, ['course-1']);
  assertEquals(ordersCalls, ['order-1']);
});

Deno.test('resolveTemplateData throws when the purchase_confirmation payload has no course_id', async () => {
  const { client } = createFakeOutboxDrainSupabase();
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        purchaseConfirmationCandidate({ payload: { order_id: 'order-1' } }),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws when the purchase_confirmation payload has no order_id', async () => {
  const { client } = createFakeOutboxDrainSupabase();
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        purchaseConfirmationCandidate({ payload: { course_id: 'course-1' } }),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws when the course lookup finds no row', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    coursesById: {},
    ordersById: {
      'order-1': { data: { amount_cents: 9900, currency: 'BRL' }, error: null },
    },
  });
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        purchaseConfirmationCandidate(),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws when the order lookup errors', async () => {
  const { client } = createFakeOutboxDrainSupabase({
    coursesById: {
      'course-1': { data: { title: 'Curso de TypeScript' }, error: null },
    },
    ordersById: {
      'order-1': { data: null, error: { message: 'db exploded' } },
    },
  });
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        purchaseConfirmationCandidate(),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws TemplateResolutionError for an unsupported template', async () => {
  const { client } = createFakeOutboxDrainSupabase();
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        welcomeCandidate({ template: 'password_reset' }),
      ),
    TemplateResolutionError,
  );
});

Deno.test('resolveTemplateData throws TemplateResolutionError for a wholly unknown template, same as a stub template', async () => {
  const { client } = createFakeOutboxDrainSupabase();
  await assertRejects(
    () =>
      resolveTemplateData(
        client as unknown as SupabaseClient,
        welcomeCandidate({ template: 'never_heard_of_it' }),
      ),
    TemplateResolutionError,
  );
});
