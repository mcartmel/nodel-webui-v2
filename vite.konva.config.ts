import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  // Publish only explicit offline attribution/licence data, not the
  // application's general public tree.
  publicDir: false,
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  plugins: [{
    name: 'konva-local-identity-license',
    generateBundle() {
      const licenses = resolve(root, 'src/experiments/konva-canvas/licenses');
      for (const fileName of ['CC-BY-SA-3.0.txt', 'CodeIgniter-MIT.txt', 'topology-simple-name-NOTICE.txt']) {
        this.emitFile({ type: 'asset', fileName: `v2/licenses/${fileName}`, source: readFileSync(resolve(licenses, fileName), 'utf8') });
      }
      this.emitFile({ type: 'asset', fileName: 'v2/licenses/MPL-2.0.txt', source: readFileSync(resolve(root, 'LICENSE'), 'utf8') });
      this.emitFile({
        type: 'asset',
        fileName: 'v2/licenses/topology-simple-name-transliterations.json',
        source: readFileSync(resolve(root, 'src/experiments/konva-canvas/local-simple-name-transliterations.json'), 'utf8')
      });
    }
  }],
  build: {
    outDir: resolve(root, 'build/experiments/konva-canvas'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'topology-canvas.html') }
  }
});
