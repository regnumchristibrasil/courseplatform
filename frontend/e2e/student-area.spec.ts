import { expect, test } from '@playwright/test'
import { COURSE_FIXTURES, resetCourseFixtures } from './courseFixtures.ts'
import { FIXTURES } from './fixtures.ts'
import { loginViaUi, resetFixtures } from './helpers.ts'

const { student } = FIXTURES
const { watch, expired } = COURSE_FIXTURES

// Progresso e comentários do aluno vivem em cascata nos cursos de fixture: recriá-los zera tudo.
test.beforeEach(async () => {
  await resetFixtures()
  resetCourseFixtures()
})

test.describe('student area', () => {
  test('student opens a purchased course, completes a lesson, comments and sees progress change', async ({ page }) => {
    await loginViaUi(page, student)
    await expect(page).toHaveURL(/\/meus-cursos$/)

    const card = page.getByRole('article', { name: watch.title })
    await expect(card.getByRole('progressbar', { name: 'Progresso do curso' })).toHaveAttribute('aria-valuenow', '0')
    await card.getByRole('link', { name: 'Continuar' }).click()

    await expect(page.getByRole('heading', { name: watch.title, level: 1 })).toBeVisible()
    await page.getByRole('link', { name: 'Continuar de onde parei' }).click()

    await expect(page.getByRole('heading', { name: 'E2E Aula um', level: 1 })).toBeVisible()
    const panel = page.getByRole('region', { name: 'Progresso' })
    const progress = panel.getByRole('progressbar', { name: 'Progresso do curso' })
    await expect(progress).toHaveAttribute('aria-valuenow', '0')

    const complete = panel.getByRole('button', { name: 'Marcar como concluído' })
    await expect(complete).toHaveAttribute('aria-pressed', 'false')
    await complete.click()
    await expect(complete).toHaveAttribute('aria-pressed', 'true')
    await expect(progress).toHaveAttribute('aria-valuenow', '50')

    await expect(page.getByText('Nenhum comentário ainda. Seja o primeiro a comentar.')).toBeVisible()
    await page.getByLabel('Escreva um comentário').fill('E2E comentário do aluno')
    await page.getByRole('button', { name: 'Publicar' }).click()
    await expect(page.getByText('E2E comentário do aluno')).toBeVisible()
    await expect(page.getByText('Nenhum comentário ainda. Seja o primeiro a comentar.')).toHaveCount(0)

    // O progresso persiste fora da página da aula.
    await page.getByRole('link', { name: 'Meus cursos', exact: true }).click()
    const refreshed = page.getByRole('article', { name: watch.title })
    await expect(refreshed.getByRole('progressbar', { name: 'Progresso do curso' })).toHaveAttribute('aria-valuenow', '50')
  })

  test('expired course is dimmed in the list and not found by direct URL', async ({ page }) => {
    await loginViaUi(page, student)
    await expect(page).toHaveURL(/\/meus-cursos$/)

    const card = page.getByRole('article', { name: expired.title })
    await expect(card.getByText('Acesso expirado')).toBeVisible()
    await expect(card.getByRole('link', { name: 'Comprar novamente' })).toBeVisible()

    await page.goto(`/meus-cursos/${expired.id}`)
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
    await expect(page.getByRole('heading', { name: expired.title })).toHaveCount(0)
  })
})
