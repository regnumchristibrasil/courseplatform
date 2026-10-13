import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_MAX_LENGTH, type LessonComment } from '../../contracts/studentArea'
import { renderWithProviders } from '../../test/renderWithProviders'
import { createLessonComment, listLessonComments, StudentAreaApiError } from './commentsApi'
import { LessonComments } from './LessonComments'

vi.mock('./commentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commentsApi')>()
  return { ...actual, listLessonComments: vi.fn(), createLessonComment: vi.fn() }
})

function comment(n: number, overrides: Partial<LessonComment> = {}): LessonComment {
  return {
    id: `c${n}`,
    authorFirstName: `Autor${n}`,
    isStaffAuthor: false,
    body: `Texto ${n}`,
    createdAt: `2026-01-01T10:00:0${n}Z`,
    isOwn: false,
    ...overrides,
  }
}

function renderComments() {
  return renderWithProviders(<LessonComments lessonId="l1" />)
}

describe('LessonComments', () => {
  beforeEach(() => {
    vi.mocked(listLessonComments).mockReset().mockResolvedValue({ comments: [], nextCursor: null })
    vi.mocked(createLessonComment).mockReset().mockResolvedValue(comment(9, { isOwn: true }))
  })

  it('shows a loading state first', () => {
    vi.mocked(listLessonComments).mockReturnValue(new Promise(() => {}))
    renderComments()
    expect(screen.getByRole('status', { name: /carregando comentários/i })).toBeInTheDocument()
  })

  it('shows the empty state when there are no comments', async () => {
    renderComments()
    expect(await screen.findByText(/nenhum comentário ainda/i)).toBeInTheDocument()
  })

  it('lists comments with first name and a Equipe badge only for staff', async () => {
    vi.mocked(listLessonComments).mockResolvedValue({
      comments: [comment(2, { isStaffAuthor: true, authorFirstName: 'Tutor' }), comment(1)],
      nextCursor: null,
    })
    renderComments()
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Tutor')).toBeInTheDocument()
    expect(within(items[0]).getByText('Equipe')).toBeInTheDocument()
    expect(within(items[0]).getByText('Texto 2')).toBeInTheDocument()
    expect(within(items[1]).getByText('Autor1')).toBeInTheDocument()
    expect(within(items[1]).queryByText('Equipe')).not.toBeInTheDocument()
  })

  it('renders the body as plain text, never as markup', async () => {
    vi.mocked(listLessonComments).mockResolvedValue({
      comments: [comment(1, { body: '<img src=x onerror=alert(1)> <b>negrito</b>' })],
      nextCursor: null,
    })
    const { container } = renderComments()
    expect(await screen.findByText(/<b>negrito<\/b>/)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('loads the first page without a cursor and hides the button when it is the last page', async () => {
    renderComments()
    await screen.findByText(/nenhum comentário ainda/i)
    expect(listLessonComments).toHaveBeenCalledWith(expect.anything(), 'l1', null)
    expect(screen.queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument()
  })

  it('appends the next page using the cursor when "Carregar mais" is clicked', async () => {
    const cursor = { createdAt: '2026-01-01T10:00:02Z', id: 'c2' }
    vi.mocked(listLessonComments)
      .mockResolvedValueOnce({ comments: [comment(2)], nextCursor: cursor })
      .mockResolvedValueOnce({ comments: [comment(1)], nextCursor: null })
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: /carregar mais/i }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(listLessonComments).toHaveBeenLastCalledWith(expect.anything(), 'l1', cursor)
    expect(screen.queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument()
  })

  it('shows an error with retry when the list fails', async () => {
    vi.mocked(listLessonComments).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ comments: [], nextCursor: null })
    renderComments()
    expect(await screen.findByText(/não foi possível carregar os comentários/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByText(/nenhum comentário ainda/i)).toBeInTheDocument()
  })

  describe('form', () => {
    it('keeps submit disabled for blank text and shows the counter', async () => {
      renderComments()
      const field = await screen.findByLabelText(/escreva um comentário/i)
      const submit = screen.getByRole('button', { name: /publicar/i })
      expect(screen.getByText(`0/${COMMENT_MAX_LENGTH}`)).toBeInTheDocument()
      expect(submit).toBeDisabled()
      await userEvent.type(field, '   ')
      expect(submit).toBeDisabled()
      await userEvent.type(field, 'oi')
      expect(submit).toBeEnabled()
      expect(screen.getByText(`5/${COMMENT_MAX_LENGTH}`)).toBeInTheDocument()
    })

    it('limits the text to the maximum length', async () => {
      renderComments()
      const field = await screen.findByLabelText(/escreva um comentário/i)
      expect(field).toHaveAttribute('maxlength', String(COMMENT_MAX_LENGTH))
    })

    it('publishes trimmed-by-server text, clears the field and reloads the list', async () => {
      renderComments()
      await userEvent.type(await screen.findByLabelText(/escreva um comentário/i), 'Otima aula')
      await userEvent.click(screen.getByRole('button', { name: /publicar/i }))
      await waitFor(() => expect(createLessonComment).toHaveBeenCalledWith(expect.anything(), 'l1', 'Otima aula'))
      await waitFor(() => expect(screen.getByLabelText(/escreva um comentário/i)).toHaveValue(''))
      await waitFor(() => expect(listLessonComments).toHaveBeenCalledTimes(2))
    })

    it('disables the form while publishing to prevent double submit', async () => {
      vi.mocked(createLessonComment).mockReturnValue(new Promise(() => {}))
      renderComments()
      await userEvent.type(await screen.findByLabelText(/escreva um comentário/i), 'oi')
      await userEvent.click(screen.getByRole('button', { name: /publicar/i }))
      await waitFor(() => expect(screen.getByRole('button', { name: /publicar/i })).toBeDisabled())
      expect(createLessonComment).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['rate_limited', /aguarde um instante antes de comentar de novo/i],
      ['forbidden', /você não pode comentar nesta aula/i],
      ['invalid_input', /o comentário deve ter entre 1 e 2\.000 caracteres/i],
      ['unauthorized', /sua sessão expirou/i],
    ] as const)('shows the message for %s and keeps the typed text', async (code, message) => {
      vi.mocked(createLessonComment).mockRejectedValue(new StudentAreaApiError(code, code))
      renderComments()
      await userEvent.type(await screen.findByLabelText(/escreva um comentário/i), 'meu texto')
      await userEvent.click(screen.getByRole('button', { name: /publicar/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByLabelText(/escreva um comentário/i)).toHaveValue('meu texto')
    })

    it('shows a generic message for unexpected failures', async () => {
      vi.mocked(createLessonComment).mockRejectedValue(new Error('boom'))
      renderComments()
      await userEvent.type(await screen.findByLabelText(/escreva um comentário/i), 'oi')
      await userEvent.click(screen.getByRole('button', { name: /publicar/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível publicar o comentário/i)
    })

    it('clears the error when the user edits the text', async () => {
      vi.mocked(createLessonComment).mockRejectedValue(new StudentAreaApiError('rate_limited', 'rate_limited'))
      renderComments()
      const field = await screen.findByLabelText(/escreva um comentário/i)
      await userEvent.type(field, 'oi')
      await userEvent.click(screen.getByRole('button', { name: /publicar/i }))
      await screen.findByRole('alert')
      await userEvent.type(field, '!')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
