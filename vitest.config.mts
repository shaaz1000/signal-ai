import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname) } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Integration setup seeds a database by running the whole pipeline, which can exceed the 10 s default on a busy machine.
    hookTimeout: 60_000,
    env: { LOG_SILENT: '1' },
  },
});
