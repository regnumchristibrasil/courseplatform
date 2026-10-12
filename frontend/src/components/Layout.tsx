import { Link, Outlet, useNavigate } from 'react-router-dom'
import { COMPANY_NAME } from '../config/brand'
import { useAuth } from '../features/auth/useAuth'
import { AdminNavLink } from '../features/authz/AdminNavLink'
import { NavItem } from './NavItem'
import { Button } from './ui/Button'
import styles from './Layout.module.css'

export function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.logoPlaceholder} data-testid="logo-placeholder" aria-hidden="true" />
          {COMPANY_NAME}
        </Link>
        <nav className={styles.nav} aria-label="Principal">
          <NavItem to="/" end>
            Catálogo
          </NavItem>
          {user ? (
            <>
              <AdminNavLink />
              <span className={styles.userEmail}>{user.email}</span>
              <Button variant="secondary" onClick={handleSignOut}>
                Sair
              </Button>
            </>
          ) : (
            <>
              <NavItem to="/login">Entrar</NavItem>
              <NavItem to="/signup">Cadastrar</NavItem>
            </>
          )}
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <p>
          © {new Date().getFullYear()} {COMPANY_NAME}
        </p>
      </footer>
    </div>
  )
}
