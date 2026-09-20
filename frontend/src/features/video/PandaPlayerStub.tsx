import { Alert } from '../../components/ui/Alert'

export interface PandaPlayerStubProps {
  readonly embedUrl: string
  readonly expiresAt: string
}

// Deliberate, clearly-marked stub. Panda Video is production-phase work —
// it needs its own player/SDK to handle signed, expiring playback URLs
// (re-resolving on expiry), unlike the YouTube phase's permanent links.
// This intentionally does not attempt to embed `embedUrl` directly.
export function PandaPlayerStub({ embedUrl, expiresAt }: PandaPlayerStubProps) {
  return (
    <div data-testid="panda-player-stub">
      <Alert variant="warning">
        <p>
          O player do Panda Video ainda não foi implementado nesta fase do projeto
          (fase de produção). Referência resolvida: <code>{embedUrl}</code>, válida até{' '}
          <code>{expiresAt}</code>.
        </p>
      </Alert>
    </div>
  )
}
