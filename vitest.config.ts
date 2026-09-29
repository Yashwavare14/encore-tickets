import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
