import { NavLink, type NavLinkProps } from 'react-router-dom'
import styles from './NavItem.module.css'

type NavItemProps = Omit<NavLinkProps, 'className'>

export function NavItem(props: NavItemProps) {
  return <NavLink {...props} className={({ isActive }) => (isActive ? `${styles.item} ${styles.active}` : styles.item)} />
}
