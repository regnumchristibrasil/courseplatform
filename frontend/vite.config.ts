import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
    // Specs do Playwright (e2e/) rodam com `npm run test:e2e`, não no vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
