import { expect, test } from '@playwright/test'
import { FIXTURES } from './fixtures.ts'
import { dialog, loginViaUi, openUsersViaNav, passwordSignIn, resetFixtures, userRow } from './helpers.ts'

const { superadmin, admin, tutor, student } = FIXTURES

// Os fluxos mutam os mesmos usuários: cada teste parte do estado do seed.
test.beforeEach(async () => {
  await resetFixtures()
})

test.describe('admin users management', () => {
  test('superadmin changes the student role to tutor with a reason', async ({ page }) => {
    await loginViaUi(page, superadmin)
    await openUsersViaNav(page)

    await expect(userRow(page, student)).toContainText('Aluno')
    await page.getByRole('button', { name: `Alterar papel de ${student.email}` }).click()

    await expect(dialog(page).getByRole('heading', { name: 'Alterar papel' })).toBeVisible()
    await dialog(page).getByLabel('Novo papel').selectOption({ label: 'Tutor' })
    await dialog(page).getByLabel('Motivo (opcional)').fill('Promoção de teste E2E')
    await dialog(page).getByRole('button', { name: 'Confirmar' }).click()

    await expect(dialog(page)).toBeHidden()
    await expect(userRow(page, student)).toContainText('Tutor')
  })

  test('admin sees no actions on admin/superadmin rows nor on the own row', async ({ page }) => {
    await loginViaUi(page, admin)
    await openUsersViaNav(page)

    await expect(userRow(page, student)).toBeVisible()
    for (const protectedUser of [admin, superadmin]) {
      await expect(userRow(page, protectedUser)).toBeVisible()
      await expect(userRow(page, protectedUser).getByRole('button')).toHaveCount(0)
    }
    for (const managed of [student, tutor]) {
      await expect(userRow(page, managed).getByRole('button', { name: `Alterar papel de ${managed.email}` })).toBeVisible()
      await expect(userRow(page, managed).getByRole('button', { name: `Desativar ${managed.email}` })).toBeVisible()
    }
  })

  test('superadmin deactivates and reactivates the student, enforced by real Auth', async ({ page }) => {
    await loginViaUi(page, superadmin)
    await openUsersViaNav(page)
    expect((await passwordSignIn(student)).ok).toBe(true)

    await page.getByRole('button', { name: `Desativar ${student.email}` }).click()
    await dialog(page).getByLabel('Motivo (opcional)').fill('Desativação de teste E2E')
    await dialog(page).getByRole('button', { name: 'Confirmar' }).click()

    await expect(dialog(page)).toBeHidden()
    await expect(userRow(page, student)).toContainText('Inativo')
    await expect.poll(async () => (await passwordSignIn(student)).ok).toBe(false)

    await page.getByRole('button', { name: `Reativar ${student.email}` }).click()
    await dialog(page).getByRole('button', { name: 'Confirmar' }).click()

    await expect(dialog(page)).toBeHidden()
    await expect(userRow(page, student)).toContainText('Ativo')
    await expect(userRow(page, student)).not.toContainText('Inativo')
    await expect.poll(async () => (await passwordSignIn(student)).ok).toBe(true)
  })

  test('student gets NotFound on /admin/users and no Administração link', async ({ page }) => {
    await loginViaUi(page, student)
    await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0)

    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Usuários', level: 1 })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0)
  })

  test('stale change is rejected with stale_target and a reload action', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await loginViaUi(pageA, superadmin)
      await openUsersViaNav(pageA)
      await expect(userRow(pageA, student)).toContainText('Aluno')

      await loginViaUi(pageB, superadmin)
      await openUsersViaNav(pageB)
      await pageB.getByRole('button', { name: `Alterar papel de ${student.email}` }).click()
      await dialog(pageB).getByLabel('Novo papel').selectOption({ label: 'Tutor' })
      await dialog(pageB).getByRole('button', { name: 'Confirmar' }).click()
      await expect(dialog(pageB)).toBeHidden()
      await expect(userRow(pageB, student)).toContainText('Tutor')

      // Contexto A ainda mostra o aluno com papel antigo.
      await expect(userRow(pageA, student)).toContainText('Aluno')
      await pageA.getByRole('button', { name: `Alterar papel de ${student.email}` }).click()
      // Papel diferente do aplicado por B: pedir o mesmo papel seria um no-op idempotente.
      await dialog(pageA).getByLabel('Novo papel').selectOption({ label: 'Administrador' })
      await dialog(pageA).getByRole('button', { name: 'Confirmar' }).click()

      await expect(dialog(pageA).getByText('Este usuário foi alterado por outra pessoa. Recarregue a lista e tente novamente.')).toBeVisible()
      await dialog(pageA).getByRole('button', { name: 'Recarregar lista' }).click()
      await expect(userRow(pageA, student)).toContainText('Tutor')
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
