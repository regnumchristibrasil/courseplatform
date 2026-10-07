import { Link } from 'react-router-dom'
import { isStaffRole } from './roles'
import { useCurrentAccess } from './useCurrentAccess'

// UX only: the route guard and the server enforce access independently.
export function AdminNavLink() {
  const { data } = useCurrentAccess()
  if (!data || !data.isActive || !isStaffRole(data.role)) return null
  return <Link to="/admin/users">Administração</Link>
}
