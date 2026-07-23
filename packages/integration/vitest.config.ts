import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

config()

export default defineConfig({
  test: {
    environment: 'node',
    include:     ['src/**/*.test.ts'],
    testTimeout: 60000,
  },
})
