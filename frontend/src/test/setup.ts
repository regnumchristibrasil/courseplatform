import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest globals are intentionally off (see vite.config.ts) so every test
// file imports its own `describe`/`it`/`expect`. That means Testing
// Library's automatic per-test cleanup (which relies on a global
// `afterEach`) needs to be wired up explicitly here instead.
afterEach(() => {
  cleanup()
})
