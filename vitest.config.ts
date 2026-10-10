import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'core/src/**/*.test.ts',
      'server/src/**/*.test.ts',
      'web/src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
    ],
  },
});
