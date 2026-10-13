import type { CourseTree, CourseTreeLesson, CourseTreeModule } from '../../contracts/studentArea'

export interface LessonContext {
  readonly lesson: CourseTreeLesson
  readonly module: CourseTreeModule
  readonly previous: CourseTreeLesson | null
  readonly next: CourseTreeLesson | null
}

// Anterior/próxima seguem a ordem do curso (módulos e aulas ativos, já
// ordenados pelo servidor), atravessando módulos. null = fora da árvore
// (arquivada ou inexistente), que a tela trata como não encontrada.
export function findLessonContext(tree: CourseTree, lessonId: string): LessonContext | null {
  const ordered = tree.modules.flatMap((module) => module.lessons.map((lesson) => ({ lesson, module })))
  const index = ordered.findIndex((entry) => entry.lesson.id === lessonId)
  if (index === -1) return null
  const current = ordered[index]
  return {
    lesson: current.lesson,
    module: current.module,
    previous: ordered[index - 1]?.lesson ?? null,
    next: ordered[index + 1]?.lesson ?? null,
  }
}
