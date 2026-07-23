import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/index.ts',           // barrel re-export, no logic
      ],
      thresholds: {
        statements: 90,
        functions:  90,
        lines:      90,
        branches:   70,
      },
    },
  },
})
