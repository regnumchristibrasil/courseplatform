import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeClient } from './fakes.ts';
import { CourseLookupError, fetchPublishedCourse } from './courses.ts';

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    title: 'Curso de Exemplo',
    price_cents: 4990,
    status: 'published',
    ...overrides,
  };
}

Deno.test('fetchPublishedCourse returns the mapped course when published', async () => {
  const { client } = createFakeClient({
    courses: { select: { data: courseRow(), error: null } },
  });
  const course = await fetchPublishedCourse(client as unknown as SupabaseClient, 'course-1');
  assertEquals(course, { id: 'course-1', title: 'Curso de Exemplo', priceCents: 4990 });
});

Deno.test('fetchPublishedCourse returns null when no row is found', async () => {
  const { client } = createFakeClient({ courses: { select: { data: null, error: null } } });
  const course = await fetchPublishedCourse(client as unknown as SupabaseClient, 'missing');
  assertEquals(course, null);
});

Deno.test('fetchPublishedCourse returns null when the course is a draft (not published)', async () => {
  const { client } = createFakeClient({
    courses: { select: { data: courseRow({ status: 'draft' }), error: null } },
  });
  const course = await fetchPublishedCourse(client as unknown as SupabaseClient, 'course-1');
  assertEquals(course, null);
});

Deno.test('fetchPublishedCourse returns null when the course is archived (not published)', async () => {
  const { client } = createFakeClient({
    courses: { select: { data: courseRow({ status: 'archived' }), error: null } },
  });
  const course = await fetchPublishedCourse(client as unknown as SupabaseClient, 'course-1');
  assertEquals(course, null);
});

Deno.test('fetchPublishedCourse throws CourseLookupError on a DB error', async () => {
  const { client } = createFakeClient({
    courses: { select: { data: null, error: { message: 'connection reset' } } },
  });
  await assertRejects(
    () => fetchPublishedCourse(client as unknown as SupabaseClient, 'course-1'),
    CourseLookupError,
  );
});

Deno.test('fetchPublishedCourse queries by id and selects the expected columns', async () => {
  const { client, calls } = createFakeClient({
    courses: { select: { data: null, error: null } },
  });
  await fetchPublishedCourse(client as unknown as SupabaseClient, 'course-1');
  assertEquals(calls[0], {
    table: 'courses',
    method: 'select',
    args: ['id, title, price_cents, status'],
  });
  assertEquals(calls[1], { table: 'courses', method: 'eq', args: ['id', 'course-1'] });
  assertEquals(calls[2], { table: 'courses', method: 'maybeSingle', args: [] });
});
