import { configDefaults, defineConfig } from 'vitest/config';
import type { Plugin, UserConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import packageMetadata from './package.json';
import { serializeComponentContract } from './src/component-contract/serialize';
import { bundleGraphPlugin } from './scripts/bundle-graph.mjs';
import { validateIconArtifact, validateIconCatalogue, validateIconShard } from './scripts/icon-artifact.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const componentContractPath = '/v2/nodel-components.json';

function iconAssetsPlugin({ iconProfile, iconAssetRoot, proLocalBuild }: { iconProfile: 'free' | 'pro-local'; iconAssetRoot: string; proLocalBuild: boolean }): Plugin {
  const indexPath = resolve(iconAssetRoot, 'v2/nodel-icons.json');
  if (!existsSync(indexPath)) throw new Error(`${iconProfile} icon assets are missing. Run the matching icon generation command before invoking Vite.`);
  let index: Record<string, unknown>;
  try { index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>; validateIconArtifact(index, { expectedProfile: iconProfile }); } catch (error) { throw new Error(`${iconProfile} icon assets are invalid: ${error instanceof Error ? error.message : String(error)}`); }
  const declared = new Set<string>(['v2/nodel-icons.json', String(index.cataloguePath)]);
  const shardMetadata = new Map<string, { family: string; style: string; bucket: number }>();
  for (const family of index.families as Array<{ family: string; styles: Array<{ style: string; shards: string[] }> }>) for (const style of family.styles) for (const [bucket, path] of style.shards.entries()) { declared.add(path); shardMetadata.set(path, { family: family.family, style: style.style, bucket }); }
  const sources = new Map<string, string>();
  for (const path of declared) {
    const sourcePath = resolve(iconAssetRoot, path);
    if (!existsSync(sourcePath)) throw new Error(`${iconProfile} icon asset is declared but missing: ${path}`);
    const source = readFileSync(sourcePath, 'utf8');
    try {
      const artifact = JSON.parse(source) as Record<string, unknown>;
      if (path === String(index.cataloguePath)) validateIconCatalogue(artifact, { expectedProfile: iconProfile, index });
      else if (path !== 'v2/nodel-icons.json') {
        const metadata = shardMetadata.get(path);
        if (!metadata) throw new Error(`Unrecognized icon shard path: ${path}`);
        validateIconShard(artifact, { profile: iconProfile, ...metadata });
      }
      const expectedDigest = path === String(index.cataloguePath) ? path.match(/catalogue-([0-9a-f]{16})\.json$/)?.[1] : path.match(/-([0-9a-f]{12})\.json$/)?.[1];
      if (expectedDigest && !createHash('sha256').update(source).digest('hex').startsWith(expectedDigest)) throw new Error(`Content hash does not match generated path: ${path}`);
    } catch (error) { throw new Error(`${iconProfile} icon asset is invalid: ${path}: ${error instanceof Error ? error.message : String(error)}`); }
    sources.set(path, source);
  }
  return {
    name: 'nodel-icon-assets',
    configResolved(config) {
      if (proLocalBuild && resolve(config.build.outDir) !== resolve(projectRoot, 'build/pro-dist')) {
        throw new Error('Pro-local builds may only write to build/pro-dist.');
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://vite.invalid').pathname;
         const path = pathname.slice(1);
         if (request.method !== 'GET' && request.method !== 'HEAD') return next();
         const isIconNamespace = path === 'v2/nodel-icons.json' || path.startsWith('v2/icons/');
         if (!isIconNamespace) return next();
         if (!declared.has(path)) { response.statusCode = 404; response.end('Not found'); return; }
        const source = sources.get(path)!;
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('content-length', Buffer.byteLength(source));
        response.end(request.method === 'HEAD' ? undefined : source);
      });
    },
    generateBundle() { for (const [fileName, source] of sources) this.emitFile({ type: 'asset', fileName, source }); }
  };
}

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

export function createViteConfig(mode = 'public'): UserConfig {
  // Environment variables are intentionally not a profile selector: inherited credentials
  // must never turn a public command into a Pro build.
  const proLocalBuild = mode === 'pro-local';
  const iconProfile = proLocalBuild ? 'pro-local' : 'free';
  const outputRoot = proLocalBuild ? 'build/pro-dist' : 'dist';
  const iconAssetRoot = resolve(projectRoot, proLocalBuild ? 'build/icon-assets/pro-local' : 'build/icon-assets/free');
  const bundleGraphPath = resolve(projectRoot, proLocalBuild ? 'build/pro-reports/bundle-graph.json' : 'build/bundle-graph.json');
  return {
    base: './',
    plugins: [iconAssetsPlugin({ iconProfile, iconAssetRoot, proLocalBuild }), componentContractPlugin(), cssBeforeEntryScriptPlugin(), bundleGraphPlugin(projectRoot, resolve(projectRoot, outputRoot), bundleGraphPath)],
    server: {
      host: '0.0.0.0'
    },
    build: {
      outDir: outputRoot,
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
      exclude: [...configDefaults.exclude, 'e2e/**', '.kilo/**'],
      testTimeout: 30000,
      coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.ts'
      ],
      all: true,
      exclude: ['src/**/*.d.ts', 'src/**/generated/**', 'src/**/fixtures/**'],
      thresholds: {
        perFile: true,
        lines: 0,
        statements: 0,
        functions: 0,
        branches: 0,
        'src/api/codecs/nodel-codecs.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/api/request.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/utils/urls.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/utils/node-file-path.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/utils/json-value.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/schema/schema-model.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/schema/schema-values.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/schema/schema-validation.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/action-bindings.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/signal-bindings.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/control-actions.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/activity-accumulator.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/node-restart-source.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/utils/latest-operation-coordinator.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/editor/editor-document-session.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/editor/editor-file-operations.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/editor/editor-restart-bridge.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/editor/editor-upload-staging.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/features/bindings-model.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/features/bindings-lookup.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/features/bindings-controller.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/navigation/app-navigation-controller.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/connectivity.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/connectivity-presentation.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/data/node-restart-refresh-controller.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/features/actsig-model.ts': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/features/actsig-controller.ts': { lines: 90, statements: 90, functions: 90, branches: 85 }
      }
    }
  }
  };
}

export default defineConfig(({ mode }) => createViteConfig(mode));
