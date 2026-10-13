// Raiz constante: invalidateQueries atua por prefixo (progresso, matrícula).
export const MY_COURSES_QUERY_KEY = ['student', 'my-courses'] as const

export function myCoursesKey(userId: string): readonly ['student', 'my-courses', string] {
  return [...MY_COURSES_QUERY_KEY, userId]
}
