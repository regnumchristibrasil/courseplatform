import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import type { CommentThread, LessonComment } from '../../contracts/studentArea'
import { CommentForm } from './CommentForm'
import { deleteErrorMessage } from './commentErrors'
import styles from './LessonComments.module.css'
import { useDeleteLessonComment } from './useLessonComments'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function DeleteAction({ commentId }: { readonly commentId: string }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteLessonComment()

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Excluir
      </Button>
    )
  }

  return (
    <>
      <span>Excluir este comentário?</span>
      <Button variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate(commentId)}>
        Confirmar exclusão
      </Button>
      <Button variant="secondary" disabled={remove.isPending} onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
      {remove.isError ? <Alert variant="error">{deleteErrorMessage(remove.error)}</Alert> : null}
    </>
  )
}

function CommentBody({ comment }: { readonly comment: LessonComment }) {
  if (comment.isDeleted) return <p className={styles.removed}>Comentário removido</p>

  return (
    <>
      <div className={styles.meta}>
        <strong className={styles.author}>{comment.authorFirstName}</strong>
        {comment.isStaffAuthor ? <span className={styles.badge}>Equipe</span> : null}
        <time dateTime={comment.createdAt} className={styles.time}>
          {dateFormat.format(new Date(comment.createdAt))}
        </time>
      </div>
      <p className={styles.body}>{comment.body}</p>
    </>
  )
}

export interface CommentThreadItemProps {
  readonly lessonId: string
  readonly thread: CommentThread
}

// A tela só reflete o que o servidor autorizou (canDelete, isDeleted); a
// autorização de fato é das RPCs.
export function CommentThreadItem({ lessonId, thread }: CommentThreadItemProps) {
  const { root, replies } = thread
  const [replying, setReplying] = useState(false)

  return (
    <li className={styles.item}>
      <CommentBody comment={root} />
      {!root.isDeleted ? (
        <div className={styles.itemActions}>
          <Button variant="secondary" onClick={() => setReplying(true)} disabled={replying}>
            Responder
          </Button>
          {root.canDelete ? <DeleteAction commentId={root.id} /> : null}
        </div>
      ) : null}

      {replying ? (
        <div className={styles.replyForm}>
          <CommentForm
            lessonId={lessonId}
            parentId={root.id}
            label={`Escreva uma resposta a ${root.authorFirstName}`}
            submitLabel="Enviar resposta"
            onPublished={() => setReplying(false)}
            onCancel={() => setReplying(false)}
          />
        </div>
      ) : null}

      {replies.length > 0 ? (
        <ul className={styles.replies}>
          {replies.map((reply) => (
            <li key={reply.id} className={`${styles.item} ${styles.reply}`}>
              <CommentBody comment={reply} />
              {reply.canDelete ? (
                <div className={styles.itemActions}>
                  <DeleteAction commentId={reply.id} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
