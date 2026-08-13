import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/domain/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'nagashimasu-domain'
    },
    sourcemap: true,
    target: 'es2022'
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts']
  }
});
