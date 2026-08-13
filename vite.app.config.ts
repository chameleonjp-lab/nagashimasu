import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-app',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022'
  }
});
