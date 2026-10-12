import { NavItem } from '../../components/NavItem'
import { isCourseStaffRole } from './coursePermissions'
import { isStaffRole } from './roles'
import { useCurrentAccess } from './useCurrentAccess'

// UX only: the route guard and the server enforce access independently.
export function AdminNavLink() {
  const { data } = useCurrentAccess()
  if (!data || !data.isActive) return null
  return (
    <>
      {isStaffRole(data.role) ? <NavItem to="/admin/users">Administração</NavItem> : null}
      {isCourseStaffRole(data.role) ? <NavItem to="/admin/courses">Cursos</NavItem> : null}
    </>
  )
}
