import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

function cssBeforeEntryScriptPlugin(): Plugin {
  return {
    name: 'nodel-css-before-entry-script',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          /^([\t ]*<script\b[^>]*\bsrc="\.\/v2\/nodel-webui\.js"[^>]*><\/script>\r?\n)([\t ]*<link\b[^>]*\bhref="\.\/v2\/nodel-webui\.css"[^>]*>\r?\n?)/m,
          '$2$1'
        );
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [cssBeforeEntryScriptPlugin()],
  server: {
    host: '0.0.0.0'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        elements: resolve(projectRoot, 'elements.html'),
        nodes: resolve(projectRoot, 'nodes.html'),
        nodel: resolve(projectRoot, 'nodel.html'),
        toolkit: resolve(projectRoot, 'toolkit.html')
      },
      output: {
        entryFileNames: 'v2/entries/[name].js',
        chunkFileNames: (chunkInfo) =>
          chunkInfo.name === 'main' ? 'v2/nodel-webui.js' : 'v2/chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'v2/nodel-webui.css';
          }

          return 'v2/assets/[name]-[hash][extname]';
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
