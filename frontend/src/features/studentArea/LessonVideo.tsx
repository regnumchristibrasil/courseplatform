import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { LessonPlayer } from '../video/LessonPlayer'
import styles from './LessonPage.module.css'
import { useLessonVideo } from './useLessonVideo'

export function LessonVideo({ lessonId }: { lessonId: string }) {
  const { data: video, isLoading, isError, refetch } = useLessonVideo(lessonId)

  let content
  if (isLoading) {
    content = <Spinner label="Carregando o vídeo..." />
  } else if (isError) {
    content = (
      <Alert variant="error">
        <p>Não foi possível carregar o vídeo. Tente novamente.</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </Alert>
    )
  } else if (!video) {
    content = <Alert variant="warning">Vídeo indisponível para esta aula.</Alert>
  } else {
    content = <LessonPlayer video={video} />
  }

  return <div className={styles.player}>{content}</div>
}
