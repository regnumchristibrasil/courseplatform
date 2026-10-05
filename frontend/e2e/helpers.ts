import { execFileSync } from 'node:child_process'
import { expect, type Locator, type Page } from '@playwright/test'
import { FIXTURE_PASSWORD, FIXTURES, type FixtureUser } from './fixtures.ts'
import { resolveLocalSupabase } from './localSupabase.ts'

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_backend'

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function buildResetSql(): string {
  const values = Object.values(FIXTURES)
    .map((u) => `(${sqlLiteral(u.id)}::uuid, ${sqlLiteral(u.role)}, ${u.isActive})`)
    .join(', ')
  return `update app_private.user_access ua set role = f.role, is_active = f.is_active
from (values ${values}) as f(user_id, role, is_active) where ua.user_id = f.user_id;
select count(*) from auth.users where id in (${Object.values(FIXTURES).map((u) => sqlLiteral(u.id)).join(', ')});`
}

// Devolve papel/status dos usuários de fixture ao estado do seed e levanta bans do Auth.
export async function resetFixtures(): Promise<void> {
  const { apiUrl, serviceKey } = resolveLocalSupabase()
  const output = execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'],
    { input: buildResetSql(), encoding: 'utf8' },
  )
  if (!/(^|\n)5\s*$/.test(output.trim())) {
    throw new Error('Fixture users missing. Run `deno task seed:dev` in backend/ (see npm run test:e2e:setup).')
  }
  await Promise.all(
    Object.values(FIXTURES).map(async (user) => {
      const response = await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_duration: 'none' }),
      })
      if (!response.ok) throw new Error(`Could not lift Auth ban for ${user.email} (HTTP ${response.status}).`)
    }),
  )
}

// Login direto na API do Auth (sem UI): usado para checar se o servidor aceita/rejeita a senha.
export async function passwordSignIn(user: FixtureUser): Promise<{ readonly ok: boolean; readonly status: number }> {
  const { apiUrl, anonKey } = resolveLocalSupabase()
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: FIXTURE_PASSWORD }),
  })
  return { ok: response.ok, status: response.status }
}

// Login pela UI (pt-BR) e espera o cabeçalho autenticado.
export async function loginViaUi(page: Page, user: FixtureUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(user.email)
  await page.getByLabel('Senha').fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible()
}

export async function openUsersViaNav(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Administração' }).click()
  await expect(page).toHaveURL(/\/admin\/users/)
  await expect(page.getByRole('heading', { name: 'Usuários', level: 1 })).toBeVisible()
}

export function userRow(page: Page, user: FixtureUser): Locator {
  // Célula com e-mail exato: 'admin@...' também é substring de 'superadmin@...'.
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: user.email, exact: true }) })
}

export function dialog(page: Page): Locator {
  return page.getByRole('dialog')
}
