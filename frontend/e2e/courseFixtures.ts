import { runSql, sqlLiteral } from './db.ts'
import { FIXTURES } from './fixtures.ts'

// Cursos de fixture E2E: ids fixos, num bloco dedicado, para limpeza determinística.
interface LessonSeed {
  readonly title: string
  readonly youtubeId?: string
}

interface CourseSeed {
  readonly id: string
  readonly title: string
  readonly status: 'draft' | 'published'
  readonly priceCents: number
  readonly accessDurationDays: number | null
  readonly moduleTitle: string
  readonly lessons: readonly LessonSeed[]
  readonly withActiveEnrollment?: boolean
}

export interface CourseFixture {
  readonly id: string
  readonly title: string
  readonly moduleTitle: string
  readonly priceCents: number
  readonly accessDurationDays: number | null
}

const VIDEO_A = 'dQw4w9WgXcQ'
const VIDEO_B = 'jNQXAC9IVRw'

const COURSE_SEEDS = {
  gate: {
    id: 'e1000000-0000-0000-0000-000000000001',
    title: 'E2E Portão de publicação',
    status: 'draft',
    priceCents: 19900,
    accessDurationDays: 90,
    moduleTitle: 'E2E Módulo portão',
    lessons: [{ title: 'E2E Aula com vídeo', youtubeId: VIDEO_A }, { title: 'E2E Aula sem vídeo' }],
  },
  tutor: {
    id: 'e1000000-0000-0000-0000-000000000002',
    title: 'E2E Curso do tutor',
    status: 'draft',
    priceCents: 15000,
    accessDurationDays: 60,
    moduleTitle: 'E2E Módulo tutor',
    lessons: [{ title: 'E2E Aula tutor', youtubeId: VIDEO_B }],
  },
  sold: {
    id: 'e1000000-0000-0000-0000-000000000003',
    title: 'E2E Curso com vendas',
    status: 'published',
    priceCents: 9900,
    accessDurationDays: null,
    moduleTitle: 'E2E Módulo vendido',
    lessons: [{ title: 'E2E Aula vendida', youtubeId: VIDEO_A }],
    withActiveEnrollment: true,
  },
  stale: {
    id: 'e1000000-0000-0000-0000-000000000004',
    title: 'E2E Curso concorrente',
    status: 'draft',
    priceCents: 12000,
    accessDurationDays: 30,
    moduleTitle: 'E2E Módulo concorrente',
    lessons: [{ title: 'E2E Aula concorrente', youtubeId: VIDEO_B }],
  },
} as const satisfies Readonly<Record<string, CourseSeed>>

export type CourseFixtureKey = keyof typeof COURSE_SEEDS

export const COURSE_FIXTURES = Object.fromEntries(
  Object.entries(COURSE_SEEDS).map(([key, seed]) => [key, toFixture(seed)]),
) as Readonly<Record<CourseFixtureKey, CourseFixture>>

function toFixture(seed: CourseSeed): CourseFixture {
  const { id, title, moduleTitle, priceCents, accessDurationDays } = seed
  return { id, title, moduleTitle, priceCents, accessDurationDays }
}

const FIXTURE_IDS_SQL = Object.values(COURSE_SEEDS).map((seed) => sqlLiteral(seed.id)).join(', ')

function lessonSql(seed: CourseSeed, lesson: LessonSeed, index: number): string {
  const position = index + 1
  const insertLesson = `insert into public.lessons (course_id, module_id, title, position)
select ${sqlLiteral(seed.id)}::uuid, m.id, ${sqlLiteral(lesson.title)}, ${position}
from public.modules m where m.course_id = ${sqlLiteral(seed.id)}::uuid;`
  if (lesson.youtubeId === undefined) return insertLesson
  return `${insertLesson}
insert into app_private.lesson_assets (lesson_id, provider, external_ref)
select l.id, 'youtube', ${sqlLiteral(lesson.youtubeId)} from public.lessons l
where l.course_id = ${sqlLiteral(seed.id)}::uuid and l.title = ${sqlLiteral(lesson.title)};`
}

function courseSql(seed: CourseSeed): string {
  const days = seed.accessDurationDays === null ? 'null' : String(seed.accessDurationDays)
  const enrollment = seed.withActiveEnrollment
    ? `insert into public.enrollments (user_id, course_id) values (${sqlLiteral(FIXTURES.student.id)}::uuid, ${sqlLiteral(seed.id)}::uuid);`
    : ''
  return `insert into public.courses (id, title, status, price_cents, access_duration_days)
values (${sqlLiteral(seed.id)}::uuid, ${sqlLiteral(seed.title)}, 'draft', ${seed.priceCents}, ${days});
insert into public.modules (course_id, title, position) values (${sqlLiteral(seed.id)}::uuid, ${sqlLiteral(seed.moduleTitle)}, 1);
${seed.lessons.map((lesson, index) => lessonSql(seed, lesson, index)).join('\n')}
${seed.status === 'published' ? `update public.courses set status = 'published' where id = ${sqlLiteral(seed.id)}::uuid;` : ''}
${enrollment}`
}

// Remove (se existirem) e recria os cursos de fixture no estado inicial. Cursos criados
// como rascunho e publicados depois do conteúdo, para respeitar o portão de publicação.
export function resetCourseFixtures(): void {
  runSql(`begin;
delete from public.enrollments where course_id in (${FIXTURE_IDS_SQL});
delete from public.orders where course_id in (${FIXTURE_IDS_SQL});
delete from public.courses where id in (${FIXTURE_IDS_SQL});
${Object.values(COURSE_SEEDS).map(courseSql).join('\n')}
commit;`)
}

export interface CourseRow {
  readonly title: string
  readonly status: string
  readonly priceCents: number | null
  readonly accessDurationDays: number | null
}

// Lê o estado persistido do curso (nulo se não existir), para afirmar efeitos no servidor.
export function readCourse(courseId: string): CourseRow | null {
  const output = runSql(
    `select json_build_object('title', title, 'status', status, 'priceCents', price_cents, 'accessDurationDays', access_duration_days)
from public.courses where id = ${sqlLiteral(courseId)}::uuid;`,
  ).trim()
  return output === '' ? null : (JSON.parse(output) as CourseRow)
}
