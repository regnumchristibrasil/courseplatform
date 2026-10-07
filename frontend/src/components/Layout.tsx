import { Link, Outlet, useNavigate } from 'react-router-dom'
import { COMPANY_NAME } from '../config/brand'
import { useAuth } from '../features/auth/useAuth'
import { AdminNavLink } from '../features/authz/AdminNavLink'
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
          {COMPANY_NAME}
        </Link>
        <nav className={styles.nav}>
          <Link to="/">Catálogo</Link>
          {user ? (
            <>
              <AdminNavLink />
              <span>{user.email}</span>
              <Button variant="secondary" onClick={handleSignOut}>
                Sair
              </Button>
            </>
          ) : (
            <>
              <Link to="/login">Entrar</Link>
              <Link to="/signup">Cadastrar</Link>
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
