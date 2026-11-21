import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  build: {
    outDir: resolve(root, 'build/experiments/konva-canvas'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'topology-canvas.html') }
  }
});
