import {
  duplicatesOf,
  formatBRL,
  gateViolations,
  parseAccessDuration,
  parseLessonDuration,
  parsePrice,
  parseVideoInput,
} from './rules'
import type {
  Course,
  CourseMetaInput,
  CourseModule,
  CourseStatus,
  Direction,
  ErrorCode,
  Lesson,
  LessonInput,
  Outcome,
  Video,
} from './types'

// Pure stand-ins for the future SECURITY DEFINER RPCs. Each takes the whole
// state and returns the next state plus a Result, so the UI can show exactly
// what the server would answer (decisions #3, #5, #6, #7).

type Courses = readonly Course[]

const fail = (courses: Courses, code: ErrorCode, message: string): Outcome => ({
  courses,
  result: { ok: false, code, message },
})

const swap = <T,>(items: readonly T[], from: number, to: number): readonly T[] => {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const a = next[from] as T
  next[from] = next[to] as T
  next[to] = a
  return next
}

const withCourse = (courses: Courses, id: string, f: (c: Course) => Course) =>
  courses.map((c) => (c.id === id ? f(c) : c))

// Any edit that leaves a published course violating the gate is rejected (#3).
function commit(
  courses: Courses,
  next: Course,
  audit?: Outcome['audit'],
  warning?: string,
): Outcome {
  if (next.status === 'published') {
    const violations = gateViolations(next)
    if (violations.length > 0) {
      return fail(courses, 'publish_gate_violated', `Mudança rejeitada: ${violations.join(' ')}`)
    }
  }
  return { courses: withCourse(courses, next.id, () => next), result: { ok: true, warning }, audit }
}

const find = (courses: Courses, id: string) => courses.find((c) => c.id === id)

function locateLesson(course: Course, lessonId: string) {
  for (const [moduleIndex, module] of course.modules.entries()) {
    const lessonIndex = module.lessons.findIndex((l) => l.id === lessonId)
    if (lessonIndex >= 0) return { module, moduleIndex, lessonIndex, lesson: module.lessons[lessonIndex] as Lesson }
  }
  return null
}

const mapLesson = (course: Course, lessonId: string, f: (l: Lesson) => Lesson): Course => ({
  ...course,
  modules: course.modules.map((m) => ({ ...m, lessons: m.lessons.map((l) => (l.id === lessonId ? f(l) : l)) })),
})

const mapModule = (course: Course, moduleId: string, f: (m: CourseModule) => CourseModule): Course => ({
  ...course,
  modules: course.modules.map((m) => (m.id === moduleId ? f(m) : m)),
})

const isSold = (course: Course) => course.enrollments > 0 || course.pendingOrders > 0

export function saveCourseMeta(courses: Courses, courseId: string, input: CourseMetaInput): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  if (input.title.trim() === '') return fail(courses, 'invalid_input', 'Informe o título do curso.')
  const price = parsePrice(input.priceText)
  if (!price.ok) return fail(courses, 'invalid_input', price.message)
  const duration = parseAccessDuration(input.durationText)
  if (!duration.ok) return fail(courses, 'invalid_input', duration.message)

  const priceChanged = price.value !== course.priceCents
  const durationChanged = duration.value !== course.accessDurationDays
  const details = [
    priceChanged ? `preço ${formatBRL(course.priceCents)} -> ${formatBRL(price.value)}` : '',
    durationChanged ? `duração ${course.accessDurationDays ?? 'vitalício'} -> ${duration.value ?? 'vitalício'}` : '',
  ].filter(Boolean)
  const warning =
    priceChanged && course.pendingOrders > 0
      ? `${course.pendingOrders} pedido(s) pendente(s) manterão o valor antigo por até 30 minutos.`
      : undefined

  return commit(
    courses,
    { ...course, title: input.title.trim(), description: input.description.trim(), priceCents: price.value, accessDurationDays: duration.value },
    details.length > 0 ? { action: priceChanged ? 'price_changed' : 'access_duration_changed', detail: `${course.title}: ${details.join('; ')}` } : undefined,
    warning,
  )
}

const TRANSITIONS: Readonly<Record<CourseStatus, readonly CourseStatus[]>> = {
  draft: ['published'],
  published: ['draft', 'archived'],
  archived: ['draft'],
}

export function setCourseStatus(courses: Courses, courseId: string, target: CourseStatus): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  if (!TRANSITIONS[course.status].includes(target)) {
    return fail(courses, 'invalid_transition', `Transição ${course.status} -> ${target} não é permitida.`)
  }
  if (target === 'published') {
    const violations = gateViolations(course)
    if (violations.length > 0) {
      return fail(courses, 'publish_gate_violated', `Não é possível publicar: ${violations.join(' ')}`)
    }
  }
  const action = target === 'published' ? 'course_published' : target === 'archived' ? 'course_archived' : 'course_unpublished'
  return {
    courses: withCourse(courses, courseId, (c) => ({ ...c, status: target })),
    result: { ok: true },
    audit: { action, detail: `${course.title}: ${course.status} -> ${target}` },
  }
}

export function deleteCourse(courses: Courses, courseId: string): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  if (isSold(course)) {
    return fail(courses, 'has_sales', 'Curso com matrículas ou pedidos não pode ser excluído. Arquive em vez de excluir.')
  }
  return {
    courses: courses.filter((c) => c.id !== courseId),
    result: { ok: true },
    audit: { action: 'course_deleted', detail: course.title },
  }
}

export function addModule(courses: Courses, courseId: string, title: string): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  if (title.trim() === '') return fail(courses, 'invalid_input', 'Informe o título do módulo.')
  const module: CourseModule = { id: crypto.randomUUID(), title: title.trim(), archived: false, lessons: [] }
  return commit(courses, { ...course, modules: [...course.modules, module] })
}

export function renameModule(courses: Courses, courseId: string, moduleId: string, title: string): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  if (title.trim() === '') return fail(courses, 'invalid_input', 'Informe o título do módulo.')
  return commit(courses, mapModule(course, moduleId, (m) => ({ ...m, title: title.trim() })))
}

export function moveModule(courses: Courses, courseId: string, moduleId: string, direction: Direction): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  const index = course.modules.findIndex((m) => m.id === moduleId)
  return commit(courses, { ...course, modules: swap(course.modules, index, direction === 'up' ? index - 1 : index + 1) })
}

export function setModuleArchived(courses: Courses, courseId: string, moduleId: string, archived: boolean): Outcome {
  const course = find(courses, courseId)
  const module = course?.modules.find((m) => m.id === moduleId)
  if (!course || !module) return fail(courses, 'not_found', 'Módulo não encontrado.')
  return commit(
    courses,
    mapModule(course, moduleId, (m) => ({ ...m, archived })),
    { action: archived ? 'module_archived' : 'module_unarchived', detail: `${course.title} / ${module.title}` },
  )
}

export function deleteModule(courses: Courses, courseId: string, moduleId: string): Outcome {
  const course = find(courses, courseId)
  const module = course?.modules.find((m) => m.id === moduleId)
  if (!course || !module) return fail(courses, 'not_found', 'Módulo não encontrado.')
  if (module.lessons.length > 0) {
    return fail(courses, 'module_not_empty', 'Módulo com aulas não pode ser excluído. Exclua ou mova as aulas antes, ou arquive o módulo.')
  }
  if (isSold(course)) {
    return fail(courses, 'has_sales', 'Curso com matrículas ou pedidos: arquive o módulo em vez de excluir.')
  }
  return commit(
    courses,
    { ...course, modules: course.modules.filter((m) => m.id !== moduleId) },
    { action: 'module_deleted', detail: `${course.title} / ${module.title}` },
  )
}

function parseLessonInput(input: LessonInput, required: boolean) {
  if (input.title.trim() === '') return { error: 'Informe o título da aula.' } as const
  const duration = parseLessonDuration(input.durationText)
  if (!duration.ok) return { error: duration.message } as const
  if (input.videoText.trim() === '') {
    return required ? ({ error: 'Curso publicado: a aula precisa de um vídeo.' } as const) : ({ duration: duration.value, video: null } as const)
  }
  const video = parseVideoInput(input.videoText)
  if (!video.ok) return { error: video.message } as const
  return { duration: duration.value, video: video.video } as const
}

const duplicateWarning = (courses: Courses, video: Video | null, ignoreLessonId?: string) => {
  if (!video) return undefined
  const dupes = duplicatesOf(courses, video, ignoreLessonId)
  return dupes.length > 0 ? `Este vídeo também está em: ${dupes.join('; ')}.` : undefined
}

export function addLesson(courses: Courses, courseId: string, moduleId: string, input: LessonInput): Outcome {
  const course = find(courses, courseId)
  if (!course) return fail(courses, 'not_found', 'Curso não encontrado.')
  const parsed = parseLessonInput(input, course.status === 'published')
  if (parsed.error !== undefined) return fail(courses, parsed.error.startsWith('Curso publicado') ? 'publish_gate_violated' : 'invalid_input', parsed.error)
  const lesson: Lesson = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    durationSeconds: parsed.duration,
    isFreePreview: input.isFreePreview,
    archived: false,
    video: parsed.video,
  }
  return commit(
    courses,
    mapModule(course, moduleId, (m) => ({ ...m, lessons: [...m.lessons, lesson] })),
    undefined,
    duplicateWarning(courses, parsed.video),
  )
}

export function saveLesson(courses: Courses, courseId: string, lessonId: string, input: LessonInput): Outcome {
  const course = find(courses, courseId)
  const located = course ? locateLesson(course, lessonId) : null
  if (!course || !located) return fail(courses, 'not_found', 'Aula não encontrada.')
  const needsVideo = course.status === 'published' && !located.lesson.archived
  const parsed = parseLessonInput(input, needsVideo)
  if (parsed.error !== undefined) return fail(courses, parsed.error.startsWith('Curso publicado') ? 'publish_gate_violated' : 'invalid_input', parsed.error)
  const before = located.lesson.video
  const swapped = JSON.stringify(before) !== JSON.stringify(parsed.video)
  return commit(
    courses,
    mapLesson(course, lessonId, (l) => ({
      ...l,
      title: input.title.trim(),
      durationSeconds: parsed.duration,
      isFreePreview: input.isFreePreview,
      video: parsed.video,
    })),
    swapped
      ? {
          action: 'video_swapped',
          detail: `${course.title} / ${input.title.trim()}: ${before ? `${before.provider}:${before.ref}` : 'sem vídeo'} -> ${parsed.video ? `${parsed.video.provider}:${parsed.video.ref}` : 'sem vídeo'}`,
        }
      : undefined,
    swapped ? duplicateWarning(courses, parsed.video, lessonId) : undefined,
  )
}

export function moveLesson(courses: Courses, courseId: string, lessonId: string, direction: Direction): Outcome {
  const course = find(courses, courseId)
  const located = course ? locateLesson(course, lessonId) : null
  if (!course || !located) return fail(courses, 'not_found', 'Aula não encontrada.')
  const to = direction === 'up' ? located.lessonIndex - 1 : located.lessonIndex + 1
  return commit(courses, mapModule(course, located.module.id, (m) => ({ ...m, lessons: swap(m.lessons, located.lessonIndex, to) })))
}

export function moveLessonToModule(courses: Courses, courseId: string, lessonId: string, targetModuleId: string): Outcome {
  const course = find(courses, courseId)
  const located = course ? locateLesson(course, lessonId) : null
  if (!course || !located) return fail(courses, 'not_found', 'Aula não encontrada.')
  if (located.module.id === targetModuleId) return { courses, result: { ok: true } }
  const moved = located.lesson
  return commit(courses, {
    ...course,
    modules: course.modules.map((m) =>
      m.id === located.module.id
        ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) }
        : m.id === targetModuleId
          ? { ...m, lessons: [...m.lessons, moved] }
          : m,
    ),
  })
}

export function setLessonArchived(courses: Courses, courseId: string, lessonId: string, archived: boolean): Outcome {
  const course = find(courses, courseId)
  const located = course ? locateLesson(course, lessonId) : null
  if (!course || !located) return fail(courses, 'not_found', 'Aula não encontrada.')
  return commit(
    courses,
    mapLesson(course, lessonId, (l) => ({ ...l, archived })),
    { action: archived ? 'lesson_archived' : 'lesson_unarchived', detail: `${course.title} / ${located.lesson.title}` },
  )
}

export function deleteLesson(courses: Courses, courseId: string, lessonId: string): Outcome {
  const course = find(courses, courseId)
  const located = course ? locateLesson(course, lessonId) : null
  if (!course || !located) return fail(courses, 'not_found', 'Aula não encontrada.')
  if (isSold(course)) {
    return fail(courses, 'has_sales', 'Curso com matrículas ou pedidos: arquive a aula em vez de excluir.')
  }
  return commit(
    courses,
    { ...course, modules: course.modules.map((m) => ({ ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) })) },
    { action: 'lesson_deleted', detail: `${course.title} / ${located.lesson.title}` },
  )
}
