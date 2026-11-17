import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` throws on import outside a React Server Component, which
      // makes any module importing it untestable. Stubbed here so server
      // modules can be tested with their dependencies mocked; the real package
      // is untouched in the build. See test/stubs/server-only.ts.
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.ts'),
    },
  },
});
