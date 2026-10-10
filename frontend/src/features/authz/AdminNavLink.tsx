import { Link } from 'react-router-dom'
import { isCourseStaffRole } from './coursePermissions'
import { isStaffRole } from './roles'
import { useCurrentAccess } from './useCurrentAccess'

// UX only: the route guard and the server enforce access independently.
export function AdminNavLink() {
  const { data } = useCurrentAccess()
  if (!data || !data.isActive) return null
  return (
    <>
      {isStaffRole(data.role) ? <Link to="/admin/users">Administração</Link> : null}
      {isCourseStaffRole(data.role) ? <Link to="/admin/courses">Cursos</Link> : null}
    </>
  )
}
