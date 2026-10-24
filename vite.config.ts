import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
