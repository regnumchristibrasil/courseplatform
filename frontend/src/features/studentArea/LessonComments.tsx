import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import type { LessonComment } from '../../contracts/studentArea'
import { CommentForm } from './CommentForm'
import styles from './LessonComments.module.css'
import { useLessonComments } from './useLessonComments'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function CommentItem({ comment }: { readonly comment: LessonComment }) {
  return (
    <li className={styles.item}>
      <div className={styles.meta}>
        <strong className={styles.author}>{comment.authorFirstName}</strong>
        {comment.isStaffAuthor ? <span className={styles.badge}>Equipe</span> : null}
        <time dateTime={comment.createdAt} className={styles.time}>
          {dateFormat.format(new Date(comment.createdAt))}
        </time>
      </div>
      <p className={styles.body}>{comment.body}</p>
    </li>
  )
}

export interface LessonCommentsProps {
  readonly lessonId: string
}

export function LessonComments({ lessonId }: LessonCommentsProps) {
  const list = useLessonComments(lessonId)
  const comments = list.data?.pages.flatMap((page) => page.comments) ?? []

  return (
    <section className={styles.section} aria-labelledby="lesson-comments-title">
      <h2 id="lesson-comments-title" className={styles.title}>
        Comentários
      </h2>
      <CommentForm lessonId={lessonId} />

      {list.isLoading ? <Spinner label="Carregando comentários..." /> : null}

      {list.isError ? (
        <Alert variant="error">
          <p>Não foi possível carregar os comentários. Tente novamente.</p>
          <Button onClick={() => list.refetch()}>Tentar novamente</Button>
        </Alert>
      ) : null}

      {list.isSuccess && comments.length === 0 ? <p className={styles.empty}>Nenhum comentário ainda. Seja o primeiro a comentar.</p> : null}

      {comments.length > 0 ? (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      ) : null}

      {list.hasNextPage ? (
        <Button variant="secondary" isLoading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          Carregar mais
        </Button>
      ) : null}
    </section>
  )
}
