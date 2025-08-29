import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.ts',
      'src/**/?(*.)+(spec|test).ts'
    ],
  },
});