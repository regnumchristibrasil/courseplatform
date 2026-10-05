// Raiz constante: queryClient.invalidateQueries / clear() atuam por prefixo.
export const CURRENT_ACCESS_QUERY_KEY = ['me'] as const

export function currentAccessKey(userId: string): readonly ['me', string] {
  return [...CURRENT_ACCESS_QUERY_KEY, userId]
}
