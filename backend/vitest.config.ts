import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The live MongoDB suite (MONGODB_TEST_URI) may talk to a remote Atlas cluster.
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
