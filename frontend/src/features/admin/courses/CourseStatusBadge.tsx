import { Badge, type BadgeVariant } from '../../../components/ui/Badge'
import type { CourseStatus } from '../../../contracts/adminCourses'
import { STATUS_LABELS } from './format'

const STATUS_VARIANTS: Readonly<Record<CourseStatus, BadgeVariant>> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
}

export function CourseStatusBadge({ status }: { readonly status: CourseStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
}
