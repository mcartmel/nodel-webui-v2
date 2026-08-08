import { configDefaults, defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageMetadata from './package.json';
import { serializeComponentContract } from './src/component-contract/serialize';
import { bundleGraphPlugin } from './scripts/bundle-graph.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const componentContractPath = '/v2/nodel-components.json';

function componentContractPlugin(): Plugin {
  const source = serializeComponentContract(packageMetadata.version);

  return {
    name: 'nodel-component-contract',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://vite.invalid').pathname;
        if (pathname !== componentContractPath) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('content-length', Buffer.byteLength(source));
        response.end(request.method === 'HEAD' ? undefined : source);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: componentContractPath.slice(1), source });
    }
  };
}

function cssBeforeEntryScriptPlugin(): Plugin {
  return {
    name: 'nodel-css-before-entry-script',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const stableEntryHtml = html.replace(
          /(<script\b[^>]*\bsrc=")\.\/v2\/chunks\/main-[^"]+("[^>]*><\/script>)/,
          '$1./v2/nodel-webui.js$2'
        );
        const orderedHtml = stableEntryHtml.replace(
          /^([\t ]*<script\b[^>]*\bsrc="\.\/v2\/nodel-webui\.js"[^>]*><\/script>\r?\n)([\t ]*<link\b[^>]*\bhref="\.\/v2\/nodel-webui\.css"[^>]*>\r?\n?)/m,
          '$2$1'
        );

        if (!orderedHtml.includes('<title>Nodel UI Components</title>')) {
          return orderedHtml;
        }

        if (orderedHtml.includes('data-nodel-runtime="memory"')) {
          return orderedHtml;
        }

        return orderedHtml.replace(
          /<script\b(?=[^>]*\btype="module")[^>]*>/,
          (tag) => tag.replace(/>$/, ' data-nodel-runtime="memory">')
        );
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [componentContractPlugin(), cssBeforeEntryScriptPlugin(), bundleGraphPlugin(projectRoot)],
  server: {
    host: '0.0.0.0'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      preserveEntrySignatures: 'exports-only',
      input: {
        main: resolve(projectRoot, 'src/main.ts'),
        components: resolve(projectRoot, 'components.html'),
        nodes: resolve(projectRoot, 'nodes.html'),
        nodel: resolve(projectRoot, 'nodel.html'),
        toolkit: resolve(projectRoot, 'toolkit.html')
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'main' ? 'v2/nodel-webui.js' : 'v2/entries/[name].js',
        chunkFileNames: 'v2/chunks/[name]-[hash].js',
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
    globals: true,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/api/codecs/nodel-codecs.ts',
        'src/api/request.ts',
        'src/utils/urls.ts',
        'src/utils/node-file-path.ts',
        'src/utils/json-value.ts',
        'src/schema/schema-model.ts',
        'src/schema/schema-values.ts',
        'src/schema/schema-validation.ts',
        'src/data/action-bindings.ts',
        'src/data/signal-bindings.ts',
        'src/data/control-actions.ts',
        'src/data/activity-accumulator.ts',
        'src/data/node-restart-source.ts',
        'src/utils/latest-operation-coordinator.ts'
      ],
      all: false,
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85
      }
    }
  }
});
