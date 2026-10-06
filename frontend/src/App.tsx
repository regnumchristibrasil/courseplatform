import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui/Spinner'
import { PostHogProvider } from './features/analytics/PostHogProvider'
import { AuthProvider } from './features/auth/AuthProvider'
import { CourseEditorPrototype, CoursesListPrototype } from './features/admin/courses-prototype/pages'
import { ProtoLayout } from './features/admin/courses-prototype/store'
import { RoleRoute } from './features/authz/RoleRoute'
import { queryClient } from './lib/queryClient'
import { CatalogPage } from './pages/CatalogPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SignupPage } from './pages/SignupPage'

const AdminUsersPage = lazy(() => import('./features/admin/users/AdminUsersPage'))

// Composition root only — no business logic lives here. Each provider and
// page below owns and tests its own behavior; see their respective test
// files. C7/C8/C10/C11 (course detail, checkout, video player, my courses)
// are intentionally not routed yet — they depend on Edge Functions that
// haven't been built (Track B).
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<CatalogPage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="signup" element={<SignupPage />} />
                {/* PROTOTYPE (throwaway, ticket #8): in-memory course management, deliberately outside RoleRoute so it runs without the backend */}
                <Route path="admin/courses" element={<ProtoLayout />}>
                  <Route index element={<CoursesListPrototype />} />
                  <Route path=":courseId" element={<CourseEditorPrototype />} />
                </Route>
                <Route element={<RoleRoute />}>
                  <Route path="admin" element={<Navigate to="/admin/users" replace />} />
                  <Route
                    path="admin/users"
                    element={
                      <Suspense fallback={<Spinner label="Carregando página..." />}>
                        <AdminUsersPage />
                      </Suspense>
                    }
                  />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </PostHogProvider>
    </QueryClientProvider>
  )
}

export default App
