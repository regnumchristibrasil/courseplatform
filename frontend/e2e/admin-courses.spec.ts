import { expect, test, type Page } from '@playwright/test'
import { COURSE_FIXTURES, readCourse, resetCourseFixtures } from './courseFixtures.ts'
import { FIXTURES } from './fixtures.ts'
import { dialog, loginViaUi, resetFixtures } from './helpers.ts'

const { admin, tutor, student } = FIXTURES
const { gate, tutor: tutorCourse, sold, stale } = COURSE_FIXTURES

// Os fluxos mutam os mesmos cursos: cada teste parte do estado de fixture.
test.beforeEach(async () => {
  await resetFixtures()
  resetCourseFixtures()
})

async function openCourse(page: Page, title: string): Promise<void> {
  await page.getByRole('link', { name: 'Cursos', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cursos', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: title, exact: true }).click()
  await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
}

function treeItem(page: Page, label: string) {
  return page.getByRole('treeitem', { name: label })
}

test.describe('admin courses management', () => {
  test('admin publishes a course through the gate', async ({ page }) => {
    await loginViaUi(page, admin)
    await openCourse(page, gate.title)

    await page.getByRole('button', { name: 'Publicar' }).click()
    const pending = page.getByRole('list', { name: 'Pendências para publicar' })
    await expect(pending).toContainText('A aula "E2E Aula sem vídeo" está sem vídeo.')
    expect(readCourse(gate.id)?.status).toBe('draft')

    await treeItem(page, 'E2E Aula sem vídeo').click()
    await page.getByRole('button', { name: 'Definir vídeo' }).click()
    await page.getByLabel('ID ou URL do vídeo').fill('https://youtu.be/M7lc1UVf-VE')
    await page.getByRole('button', { name: 'Salvar vídeo' }).click()
    await expect(page.getByText('Vídeo salvo: YouTube: M7lc1UVf-VE.')).toBeVisible()

    await treeItem(page, gate.title).click()
    await page.getByRole('button', { name: 'Publicar' }).click()
    await expect(page.getByRole('button', { name: 'Voltar para rascunho' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Pendências para publicar' })).toHaveCount(0)
    expect(readCourse(gate.id)?.status).toBe('published')
  })

  test('tutor edits content and publishes but cannot change price or duration', async ({ page }) => {
    await loginViaUi(page, tutor)
    await openCourse(page, tutorCourse.title)

    await page.getByRole('button', { name: 'Editar detalhes' }).click()
    await expect(page.getByLabel('Preço (R$)')).toHaveAttribute('readonly', '')
    await expect(page.getByLabel('Duração do acesso (dias)')).toHaveAttribute('readonly', '')
    await expect(page.getByText('Somente administradores alteram preço e duração do acesso.')).toBeVisible()

    await page.getByLabel('Título', { exact: true }).fill('E2E Curso do tutor editado')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('heading', { name: 'E2E Curso do tutor editado', level: 2 })).toBeVisible()

    await page.getByRole('button', { name: 'Adicionar módulo' }).click()
    await page.getByLabel('Título do módulo').fill('E2E Módulo novo do tutor')
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
    await expect(treeItem(page, 'E2E Módulo novo do tutor')).toBeVisible()

    await page.getByRole('button', { name: 'Publicar' }).click()
    await expect(page.getByRole('button', { name: 'Voltar para rascunho' })).toBeVisible()

    const persisted = readCourse(tutorCourse.id)
    expect(persisted).toEqual({
      title: 'E2E Curso do tutor editado',
      status: 'published',
      priceCents: tutorCourse.priceCents,
      accessDurationDays: tutorCourse.accessDurationDays,
    })
  })

  test('delete is blocked when the course has sales', async ({ page }) => {
    await loginViaUi(page, admin)
    await openCourse(page, sold.title)

    await page.getByRole('button', { name: 'Excluir curso' }).click()
    const confirm = dialog(page)
    await expect(confirm.getByText('Este curso tem matrículas ou pedidos e não pode ser excluído. Arquive-o em vez disso.')).toBeVisible()
    await confirm.getByRole('button', { name: 'Excluir', exact: true }).click()

    // O aviso de vendas (já exibido) e o erro devolvido pelo servidor.
    await expect(confirm.getByRole('alert').filter({ hasText: 'Arquive-o em vez disso.' })).toHaveCount(2)
    await expect(page).toHaveURL(new RegExp(`/admin/courses/${sold.id}$`))
    expect(readCourse(sold.id)?.status).toBe('published')

    await confirm.getByRole('button', { name: 'Cancelar' }).click()
    await page.getByRole('button', { name: 'Arquivar' }).click()
    await expect(page.getByRole('button', { name: 'Voltar para rascunho' })).toBeVisible()
    expect(readCourse(sold.id)?.status).toBe('archived')
  })

  test('stale edit conflict recovers after re-read', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await loginViaUi(pageA, admin)
      await openCourse(pageA, stale.title)
      await loginViaUi(pageB, admin)
      await openCourse(pageB, stale.title)

      await pageB.getByRole('button', { name: 'Editar detalhes' }).click()
      await pageB.getByLabel('Título', { exact: true }).fill('E2E Editado por B')
      await pageB.getByRole('button', { name: 'Salvar' }).click()
      await expect(pageB.getByRole('heading', { name: 'E2E Editado por B', level: 2 })).toBeVisible()

      // A ainda mostra a versão antiga: salvar usa um updated_at vencido.
      await expect(pageA.getByRole('heading', { name: stale.title, level: 2 })).toBeVisible()
      await pageA.getByRole('button', { name: 'Editar detalhes' }).click()
      await pageA.getByLabel('Título', { exact: true }).fill('E2E Editado por A')
      await pageA.getByRole('button', { name: 'Salvar' }).click()
      await expect(
        pageA.getByText('Este curso foi alterado por outra pessoa. Os dados foram recarregados; revise e salve novamente.'),
      ).toBeVisible()
      expect(readCourse(stale.id)?.title).toBe('E2E Editado por B')

      // Formulário remontado com os dados relidos; salvar de novo agora vence.
      await expect(pageA.getByLabel('Título', { exact: true })).toHaveValue('E2E Editado por B')
      await pageA.getByLabel('Título', { exact: true }).fill('E2E Editado por A')
      await pageA.getByRole('button', { name: 'Salvar' }).click()
      await expect(pageA.getByRole('heading', { name: 'E2E Editado por A', level: 2 })).toBeVisible()
      expect(readCourse(stale.id)?.title).toBe('E2E Editado por A')
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('student gets NotFound on the course admin routes', async ({ page }) => {
    await loginViaUi(page, student)
    await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Cursos', exact: true })).toHaveCount(0)

    for (const path of ['/admin/courses', '/admin/courses/new', `/admin/courses/${gate.id}`]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
      await expect(page.getByRole('heading', { name: gate.title })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Novo curso' })).toHaveCount(0)
    }
  })

  test('anonymous visitor is sent to login and sees no course admin content', async ({ page }) => {
    for (const path of ['/admin/courses', `/admin/courses/${gate.id}`]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: gate.title })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Novo curso' })).toHaveCount(0)
    }
  })
})
