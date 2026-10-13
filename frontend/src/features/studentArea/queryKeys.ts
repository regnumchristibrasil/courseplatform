// Raiz constante: invalidateQueries atua por prefixo (progresso, matrícula).
export const MY_COURSES_QUERY_KEY = ['student', 'my-courses'] as const

export const COURSE_TREE_QUERY_KEY = ['student', 'course-tree'] as const

export function myCoursesKey(userId: string): readonly ['student', 'my-courses', string] {
  return [...MY_COURSES_QUERY_KEY, userId]
}

export function courseTreeKey(userId: string, courseId: string): readonly ['student', 'course-tree', string, string] {
  return [...COURSE_TREE_QUERY_KEY, userId, courseId]
}

export function lessonVideoKey(userId: string, lessonId: string): readonly ['student', 'lesson-video', string, string] {
  return ['student', 'lesson-video', userId, lessonId]
}

// Raiz constante: invalidateQueries atua por prefixo.
export const LESSON_COMMENTS_QUERY_KEY = ['student', 'lesson-comments'] as const

export function lessonCommentsKey(userId: string, lessonId: string): readonly ['student', 'lesson-comments', string, string] {
  return [...LESSON_COMMENTS_QUERY_KEY, userId, lessonId]
}
