import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import type { CourseTree } from '../../../contracts/adminCourses'
import { canPerformCourseAction } from '../../authz/coursePermissions'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { AdminCoursesApiError, SESSION_EXPIRED_MESSAGE } from './api'
import { CourseForm } from './CourseForm'
import { CourseDetailPanel } from './CourseDetailPanel'
import { CourseTreeView } from './CourseTreeView'
import { AddLessonAction, LessonActions } from './LessonActions'
import { LessonVideoAction } from './LessonVideoAction'
import { AddModuleAction, ModuleActions } from './ModuleActions'
import { COURSE_SELECTION, resolveSelection, type TreeSelection } from './courseTreeModel'
import { describeSaveError } from './saveErrors'
import { useAdminCourse } from './useAdminCourse'
import { useSaveCourse } from './useSaveCourse'
import styles from './AdminCourseDetailPage.module.css'

function errorCode(error: unknown) {
  return error instanceof AdminCoursesApiError ? error.code : 'internal'
}

function describeError(error: unknown): string {
  switch (errorCode(error)) {
    case 'not_found':
      return 'Curso não encontrado.'
    case 'forbidden':
      return 'Você não tem permissão para acessar este curso.'
    case 'unauthorized':
      return SESSION_EXPIRED_MESSAGE
    default:
      return 'Não foi possível carregar o curso. Tente novamente.'
  }
}

const RETRYABLE_CODES: readonly string[] = ['internal']

function CourseEditor({ tree, onClose }: { readonly tree: CourseTree; readonly onClose: () => void }) {
  const save = useSaveCourse()
  const role = useCurrentAccess().data?.role
  const canEditCommercial = role !== undefined && canPerformCourseAction(role, 'edit_price')

  return (
    <section aria-label="Editar curso" className={styles.editor}>
      <h2>Editar detalhes</h2>
      <CourseForm
        // Remonta com os dados relidos após um conflito (stale_target).
        key={tree.updatedAt}
        initial={{
          title: tree.title,
          description: tree.description,
          priceCents: tree.priceCents,
          accessDurationDays: tree.accessDurationDays,
        }}
        canEditCommercial={canEditCommercial}
        priceRequired={tree.status === 'published'}
        pendingOrderCount={tree.pendingOrderCount}
        isSaving={save.isPending}
        errorMessage={save.isError ? describeSaveError(save.error) : null}
        submitLabel="Salvar"
        onCancel={onClose}
        onSubmit={(fields) =>
          save.mutate(
            { action: 'update', courseId: tree.courseId, expectedUpdatedAt: tree.updatedAt, ...fields },
            { onSuccess: onClose },
          )
        }
      />
    </section>
  )
}

export function AdminCourseDetailPage() {
  const { courseId = '' } = useParams()
  const query = useAdminCourse(courseId)
  const [selection, setSelection] = useState<TreeSelection>(COURSE_SELECTION)
  const [editing, setEditing] = useState(false)
  const role = useCurrentAccess().data?.role
  const canEdit = role !== undefined && canPerformCourseAction(role, 'edit_details')
  const canEditContent = role !== undefined && canPerformCourseAction(role, 'edit_content')
  const tree = query.data
  const resolved = tree ? resolveSelection(tree, selection) : null
  const editingCourse = editing && tree !== undefined && resolved?.kind === 'course'

  return (
    <section className={`${styles.page} ph-no-capture`}>
      <Link to="/admin/courses">Voltar para cursos</Link>
      {query.isError ? (
        <Alert variant="error">
          <p>{describeError(query.error)}</p>
          {RETRYABLE_CODES.includes(errorCode(query.error)) ? (
            <Button variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>
          ) : null}
        </Alert>
      ) : null}
      {!tree && query.isPending ? <Spinner label="Carregando curso..." /> : null}
      {tree ? (
        <div className={styles.workspace}>
          <CourseTreeView tree={tree} selection={selection} onSelect={setSelection} />
          {editingCourse ? (
            <CourseEditor tree={tree} onClose={() => setEditing(false)} />
          ) : resolved ? (
            <div className={styles.side}>
              <CourseDetailPanel tree={tree} selection={resolved} onEdit={canEdit ? () => setEditing(true) : undefined} />
              {canEditContent && resolved?.kind === 'course' ? <AddModuleAction courseId={tree.courseId} /> : null}
              {canEditContent && resolved?.kind === 'module' ? (
                <>
                  <ModuleActions key={resolved.module.moduleId} tree={tree} module={resolved.module} />
                  <AddLessonAction key={`add-${resolved.module.moduleId}`} module={resolved.module} courseStatus={tree.status} />
                </>
              ) : null}
              {canEditContent && resolved?.kind === 'lesson' ? (
                <>
                  <LessonVideoAction key={`video-${resolved.lesson.lessonId}`} lesson={resolved.lesson} />
                  <LessonActions key={resolved.lesson.lessonId} tree={tree} module={resolved.module} lesson={resolved.lesson} />
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default AdminCourseDetailPage
