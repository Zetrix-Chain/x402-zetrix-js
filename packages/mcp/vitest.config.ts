import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/index.ts',         // MCP server entry, not unit-testable
        'src/lib.ts',           // barrel re-export, no logic
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
