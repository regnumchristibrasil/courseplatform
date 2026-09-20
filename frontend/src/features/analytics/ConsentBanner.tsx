import { Button } from '../../components/ui/Button'
import styles from './ConsentBanner.module.css'

export interface ConsentBannerProps {
  readonly onAccept: () => void
  readonly onDecline: () => void
}

// LGPD consent gate UI. No analytics call happens as a result of rendering
// this component — it only reports the user's choice back to the caller
// (PostHogProvider), which is the only place allowed to initialize tracking.
export function ConsentBanner({ onAccept, onDecline }: ConsentBannerProps) {
  return (
    <div className={styles.banner} role="region" aria-label="Consentimento de cookies e dados">
      <p className={styles.text}>
        Usamos dados de navegação (PostHog) para entender como você usa a plataforma e
        melhorar sua experiência, conforme a LGPD. Você pode aceitar ou recusar essa coleta a
        qualquer momento; recusar não limita o acesso aos cursos.
      </p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onDecline}>
          Recusar
        </Button>
        <Button variant="primary" onClick={onAccept}>
          Aceitar
        </Button>
      </div>
    </div>
  )
}
