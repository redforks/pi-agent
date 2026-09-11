import { defineConfig } from 'vitest/config'

// Opt-in real-pi smoke gate: `npm run test:smoke`.
export default defineConfig({
  test: {
    include: ['tests/smoke.test.ts'],
    // Booting pi and making one model call is host/network dependent.
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
})
