import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { CommentForm } from './CommentForm'
import { CommentThreadItem } from './CommentItem'
import styles from './LessonComments.module.css'
import { useLessonComments } from './useLessonComments'

export interface LessonCommentsProps {
  readonly lessonId: string
}

export function LessonComments({ lessonId }: LessonCommentsProps) {
  const list = useLessonComments(lessonId)
  const threads = list.data?.pages.flatMap((page) => page.threads) ?? []

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

      {list.isSuccess && threads.length === 0 ? <p className={styles.empty}>Nenhum comentário ainda. Seja o primeiro a comentar.</p> : null}

      {threads.length > 0 ? (
        <ul className={styles.list}>
          {threads.map((thread) => (
            <CommentThreadItem key={thread.root.id} lessonId={lessonId} thread={thread} />
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
