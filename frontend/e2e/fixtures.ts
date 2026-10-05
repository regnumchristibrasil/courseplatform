// Usuários de seed.dev.sql (backend/supabase). Senha descartável local-only,
// sobrescrevível por E2E_FIXTURE_PASSWORD.
export type FixtureKey = 'superadmin' | 'admin' | 'tutor' | 'student' | 'studentInactive'

export interface FixtureUser {
  readonly id: string
  readonly email: string
  readonly role: 'superadmin' | 'admin' | 'tutor' | 'student'
  readonly isActive: boolean
}

export const FIXTURE_PASSWORD = process.env.E2E_FIXTURE_PASSWORD ?? 'local-dev-only-123'

export const FIXTURES: Readonly<Record<FixtureKey, FixtureUser>> = {
  superadmin: { id: 'a0000000-0000-0000-0000-000000000001', email: 'superadmin@example.test', role: 'superadmin', isActive: true },
  admin: { id: 'a0000000-0000-0000-0000-000000000002', email: 'admin@example.test', role: 'admin', isActive: true },
  tutor: { id: 'a0000000-0000-0000-0000-000000000003', email: 'tutor@example.test', role: 'tutor', isActive: true },
  student: { id: 'a0000000-0000-0000-0000-000000000004', email: 'student@example.test', role: 'student', isActive: true },
  studentInactive: { id: 'a0000000-0000-0000-0000-000000000005', email: 'student-inactive@example.test', role: 'student', isActive: false },
}
