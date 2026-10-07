import { useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useState } from 'react'
import { invalidateUsersList } from './invalidation'

export interface UseConfirmActionOptions<TVars> {
  readonly mutation: Pick<UseMutationResult<unknown, Error, TVars>, 'mutate' | 'error' | 'isPending'>
  // Monta as variáveis da mutação; isRetry permite ajustar a precondição
  // otimista (ex.: expectedActive) quando o servidor já aplicou a mudança.
  readonly buildVars: (reason: string | undefined, isRetry: boolean) => TVars
  readonly onClose: () => void
}

export interface UseConfirmActionResult {
  readonly reason: string
  readonly setReason: (value: string) => void
  readonly confirm: () => void
  readonly retry: () => void
  readonly reload: () => void
  readonly error: Error | null
  readonly isPending: boolean
}

// Lógica compartilhada pelos diálogos de confirmação: motivo (trim, vazio
// vira ausente), confirmar/tentar novamente e recarregar a lista.
export function useConfirmAction<TVars>({
  mutation,
  buildVars,
  onClose,
}: UseConfirmActionOptions<TVars>): UseConfirmActionResult {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')

  function run(isRetry: boolean) {
    const trimmed = reason.trim()
    mutation.mutate(buildVars(trimmed === '' ? undefined : trimmed, isRetry), { onSuccess: onClose })
  }

  function reload() {
    void invalidateUsersList(queryClient)
    onClose()
  }

  return {
    reason,
    setReason,
    confirm: () => run(false),
    retry: () => run(true),
    reload,
    error: mutation.error,
    isPending: mutation.isPending,
  }
}
