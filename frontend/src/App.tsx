import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PostHogProvider } from './features/analytics/PostHogProvider'
import { AuthProvider } from './features/auth/AuthProvider'
import { queryClient } from './lib/queryClient'
import { CatalogPage } from './pages/CatalogPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SignupPage } from './pages/SignupPage'

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
