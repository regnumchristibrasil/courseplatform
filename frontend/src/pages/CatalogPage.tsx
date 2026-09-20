import { useEffect } from 'react'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { useAnalytics } from '../features/analytics/useAnalytics'
import { useCourses } from '../features/courses/useCourses'
import { formatAccessDuration, formatCentsToBRL } from '../lib/format'

const GENERIC_LOAD_ERROR_MESSAGE = 'Não foi possível carregar os cursos. Tente novamente.'

export function CatalogPage() {
  const { data: courses, isLoading, isError, error, refetch } = useCourses()
  const { capture } = useAnalytics()

  useEffect(() => {
    capture('catalog_viewed')
  }, [capture])

  if (isLoading) {
    return <Spinner label="Carregando cursos..." />
  }

  if (isError) {
    return (
      <Alert variant="error">
        <p>{error instanceof Error ? error.message : GENERIC_LOAD_ERROR_MESSAGE}</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </Alert>
    )
  }

  if (!courses || courses.length === 0) {
    return (
      <EmptyState
        title="Nenhum curso disponível"
        description="Volte em breve para conferir novidades."
      />
    )
  }

  return (
    <section aria-label="Catálogo de cursos">
      {courses.map((course) => (
        <Card key={course.id} title={course.title}>
          <p>{course.description}</p>
          <p>{formatCentsToBRL(course.price_cents)}</p>
          <p>{formatAccessDuration(course.access_duration_days)}</p>
        </Card>
      ))}
    </section>
  )
}
