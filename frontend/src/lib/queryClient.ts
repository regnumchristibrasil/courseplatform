import { QueryClient } from '@tanstack/react-query'

const DEFAULT_STALE_TIME_MS = 60_000
const DEFAULT_RETRY_COUNT = 1

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: DEFAULT_RETRY_COUNT,
        staleTime: DEFAULT_STALE_TIME_MS,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export const queryClient: QueryClient = createQueryClient()
