import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { initialCourses } from './fixtures'
import * as ops from './ops'
import type { AuditEntry, Course, CourseMetaInput, CourseStatus, Direction, LessonInput, Outcome, Result } from './types'

export interface ProtoApi {
  readonly saveCourseMeta: (courseId: string, input: CourseMetaInput) => Result
  readonly setCourseStatus: (courseId: string, target: CourseStatus) => Result
  readonly deleteCourse: (courseId: string) => Result
  readonly addModule: (courseId: string, title: string) => Result
  readonly renameModule: (courseId: string, moduleId: string, title: string) => Result
  readonly moveModule: (courseId: string, moduleId: string, direction: Direction) => Result
  readonly setModuleArchived: (courseId: string, moduleId: string, archived: boolean) => Result
  readonly deleteModule: (courseId: string, moduleId: string) => Result
  readonly addLesson: (courseId: string, moduleId: string, input: LessonInput) => Result
  readonly saveLesson: (courseId: string, lessonId: string, input: LessonInput) => Result
  readonly moveLesson: (courseId: string, lessonId: string, direction: Direction) => Result
  readonly moveLessonToModule: (courseId: string, lessonId: string, moduleId: string) => Result
  readonly setLessonArchived: (courseId: string, lessonId: string, archived: boolean) => Result
  readonly deleteLesson: (courseId: string, lessonId: string) => Result
}

interface ProtoContextValue {
  readonly courses: readonly Course[]
  readonly audit: readonly AuditEntry[]
  readonly api: ProtoApi
}

const ProtoContext = createContext<ProtoContextValue | null>(null)

export function useProto(): ProtoContextValue {
  const value = useContext(ProtoContext)
  if (!value) throw new Error('useProto must be used inside <ProtoLayout>')
  return value
}

// Route layout: holds the in-memory state across /admin/courses and the editor,
// and shows the last server-like answer in a sticky bar.
export function ProtoLayout(): ReactNode {
  const stateRef = useRef<readonly Course[]>(initialCourses())
  const [courses, setCourses] = useState<readonly Course[]>(stateRef.current)
  const [audit, setAudit] = useState<readonly AuditEntry[]>([])
  const [feedback, setFeedback] = useState<Result | null>(null)

  const value = useMemo<ProtoContextValue>(() => {
    const run = (op: (current: readonly Course[]) => Outcome): Result => {
      const outcome = op(stateRef.current)
      stateRef.current = outcome.courses
      setCourses(outcome.courses)
      if (outcome.audit) {
        const entry = outcome.audit
        setAudit((previous) => [
          { id: crypto.randomUUID(), at: new Date().toLocaleTimeString('pt-BR'), action: entry.action, detail: entry.detail },
          ...previous,
        ])
      }
      setFeedback(outcome.result)
      return outcome.result
    }
    const api: ProtoApi = {
      saveCourseMeta: (id, input) => run((c) => ops.saveCourseMeta(c, id, input)),
      setCourseStatus: (id, target) => run((c) => ops.setCourseStatus(c, id, target)),
      deleteCourse: (id) => run((c) => ops.deleteCourse(c, id)),
      addModule: (id, title) => run((c) => ops.addModule(c, id, title)),
      renameModule: (id, moduleId, title) => run((c) => ops.renameModule(c, id, moduleId, title)),
      moveModule: (id, moduleId, direction) => run((c) => ops.moveModule(c, id, moduleId, direction)),
      setModuleArchived: (id, moduleId, archived) => run((c) => ops.setModuleArchived(c, id, moduleId, archived)),
      deleteModule: (id, moduleId) => run((c) => ops.deleteModule(c, id, moduleId)),
      addLesson: (id, moduleId, input) => run((c) => ops.addLesson(c, id, moduleId, input)),
      saveLesson: (id, lessonId, input) => run((c) => ops.saveLesson(c, id, lessonId, input)),
      moveLesson: (id, lessonId, direction) => run((c) => ops.moveLesson(c, id, lessonId, direction)),
      moveLessonToModule: (id, lessonId, moduleId) => run((c) => ops.moveLessonToModule(c, id, lessonId, moduleId)),
      setLessonArchived: (id, lessonId, archived) => run((c) => ops.setLessonArchived(c, id, lessonId, archived)),
      deleteLesson: (id, lessonId) => run((c) => ops.deleteLesson(c, id, lessonId)),
    }
    return { courses, audit, api }
  }, [courses, audit])

  return (
    <ProtoContext.Provider value={value}>
      <div style={{ position: 'sticky', top: 0, zIndex: 30 }}>
        {feedback ? (
          <Alert variant={feedback.ok ? (feedback.warning ? 'warning' : 'success') : 'error'}>
            <p>
              {feedback.ok
                ? (feedback.warning ?? 'Salvo.')
                : `${feedback.code}: ${feedback.message}`}
            </p>
            <Button variant="secondary" onClick={() => setFeedback(null)}>Fechar</Button>
          </Alert>
        ) : null}
      </div>
      <Outlet />
    </ProtoContext.Provider>
  )
}
