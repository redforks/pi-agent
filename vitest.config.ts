import { defineConfig } from 'vitest/config'

// The default fast suite. The real-pi smoke gate lives in tests/smoke.test.ts
// and is excluded here; run it with `npm run test:smoke` (vitest.smoke.config.ts).
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/smoke.test.ts'],
  },
})
