import { Link, useNavigate } from 'react-router-dom'
import { canPerformCourseAction } from '../../authz/coursePermissions'
import { useCurrentAccess } from '../../authz/useCurrentAccess'
import { CourseForm } from './CourseForm'
import { describeSaveError } from './saveErrors'
import { useSaveCourse } from './useSaveCourse'
import styles from './AdminCourseDetailPage.module.css'

const EMPTY_COURSE = { title: '', description: null, priceCents: null, accessDurationDays: null } as const

export function AdminCourseCreatePage() {
  const navigate = useNavigate()
  const save = useSaveCourse()
  const role = useCurrentAccess().data?.role
  const canEditCommercial = role !== undefined && canPerformCourseAction(role, 'edit_price')

  return (
    <section className={`${styles.page} ph-no-capture`}>
      <Link to="/admin/courses">Voltar para cursos</Link>
      <h1>Novo curso</h1>
      <p>O curso é criado como rascunho. Preço é obrigatório apenas para publicar.</p>
      <CourseForm
        initial={EMPTY_COURSE}
        canEditCommercial={canEditCommercial}
        priceRequired={false}
        isSaving={save.isPending}
        errorMessage={save.isError ? describeSaveError(save.error) : null}
        submitLabel="Criar curso"
        onSubmit={(fields) =>
          save.mutate({ action: 'create', ...fields }, { onSuccess: ({ courseId }) => navigate(`/admin/courses/${courseId}`) })
        }
      />
    </section>
  )
}

export default AdminCourseCreatePage
