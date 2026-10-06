import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Table } from '../../../components/ui/Table'
import { PrototypeSwitcher, type VariantMeta } from './PrototypeSwitcher'
import { formatBRL } from './rules'
import { StatusBadge } from './shared'
import { useProto } from './store'
import styles from './proto.module.css'
import type { Course } from './types'
import { VariantA } from './VariantA'
import { VariantB } from './VariantB'
import { VariantC } from './VariantC'

// PROTOTYPE (throwaway), wayfinder ticket #8. Plan: three variants of the course
// editor, switchable via ?variant=A|B|C, on /admin/courses/:courseId. Shared
// list page. In-memory data only; reload resets everything.

const VARIANTS: readonly VariantMeta[] = [
  { key: 'A', name: 'Árvore + painel' },
  { key: 'B', name: 'Outline em página única' },
  { key: 'C', name: 'Abas + gaveta' },
]

export function CoursesListPrototype() {
  const { courses } = useProto()
  return (
    <div className={styles.page}>
      <h1>Cursos (protótipo)</h1>
      <Alert variant="info"><p>Protótipo descartável (ticket #8): dados em memória, nada é salvo. Abra um curso e use as setas do teclado ou a barra inferior para alternar entre as variantes A, B e C.</p></Alert>
      <Table<Course>
        caption="Cursos"
        rows={courses}
        getRowKey={(c) => c.id}
        columns={[
          { key: 'title', header: 'Curso', render: (c) => <Link to={`/admin/courses/${c.id}?variant=A`}>{c.title}</Link> },
          { key: 'status', header: 'Situação', render: (c) => <StatusBadge status={c.status} /> },
          { key: 'priceCents', header: 'Preço', render: (c) => formatBRL(c.priceCents) },
          { key: 'enrollments', header: 'Matrículas / pedidos pendentes', render: (c) => `${c.enrollments} / ${c.pendingOrders}` },
        ]}
      />
    </div>
  )
}

export function CourseEditorPrototype() {
  const { courseId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { courses, api } = useProto()
  const course = courses.find((c) => c.id === courseId)
  const variant = searchParams.get('variant') ?? 'A'

  if (!course) {
    return (
      <div className={styles.page}>
        <Alert variant="info"><p>Curso não encontrado (talvez excluído).</p></Alert>
        <Link to="/admin/courses">Voltar para a lista</Link>
      </div>
    )
  }

  const onDeleted = () => navigate('/admin/courses')
  return (
    <div className={styles.page}>
      <p><Link to="/admin/courses">&larr; Cursos</Link></p>
      {variant === 'B' ? <VariantB course={course} api={api} onDeleted={onDeleted} /> : null}
      {variant === 'C' ? <VariantC course={course} api={api} onDeleted={onDeleted} /> : null}
      {variant !== 'B' && variant !== 'C' ? <VariantA course={course} api={api} onDeleted={onDeleted} /> : null}
      <PrototypeSwitcher variants={VARIANTS} current={VARIANTS.some((v) => v.key === variant) ? variant : 'A'} />
    </div>
  )
}
