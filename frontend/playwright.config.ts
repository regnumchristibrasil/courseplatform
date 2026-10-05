import { defineConfig, devices } from '@playwright/test'
import { resolveLocalSupabase } from './e2e/localSupabase.ts'

const PORT = Number(process.env.E2E_PORT ?? 5199)
const BASE_URL = `http://127.0.0.1:${PORT}`
const supabase = resolveLocalSupabase()

// E2E contra o stack Supabase local. Ver `npm run test:e2e:setup` para os pré-requisitos.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  // Os fluxos compartilham o mesmo banco e mutam os mesmos usuários: serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: supabase.apiUrl,
      VITE_SUPABASE_ANON_KEY: supabase.anonKey,
      // Sem consentimento o PostHog nunca inicializa; valores só satisfazem a validação de env.
      VITE_POSTHOG_KEY: 'e2e-posthog-key',
      VITE_POSTHOG_HOST: 'http://127.0.0.1:1',
      VITE_APP_ENV: 'e2e',
    },
  },
})
