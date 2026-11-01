/**
 * Live public-server suite against a local (or TEST_SERVER_URL) API.
 * The default vitest.config.ts excludes src/__tests__/public-server, so this
 * suite needs its own config.  Usage: pnpm test:server
 */

import { defineConfig, mergeConfig } from 'vitest/config'
import publicConfig from './vitest.public.config'

export default mergeConfig(publicConfig, defineConfig({
  test: {
    env: {
      TEST_SERVER_URL: process.env.TEST_SERVER_URL || 'http://localhost:3001',
    },
  },
}))
