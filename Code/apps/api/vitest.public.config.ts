/**
 * Vitest config specifically for running tests against the public server.
 *
 * Usage:  pnpm test:public   (production unless TEST_SERVER_URL is set)
 *         pnpm test:server   (vitest.server.config.ts: localhost unless TEST_SERVER_URL is set)
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/public-server/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      TEST_SERVER_URL: process.env.TEST_SERVER_URL || 'https://api.coordinationmanager.com',
      TEST_TIMEOUT: '15000',
    },
  },
})
