import { createServer } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertProjectBuildTarget, componentContractPath, loadDeploymentManifest, markerName, parseStrictArgs, projectRoot, safeRelativePath, targetState, validateComponentContractArtifact } from './deployment-contract.mjs';

const contentTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'
};

export function parseDeploymentSmokeArgs(argv) {
  return parseStrictArgs(argv, {
    'preview-root': { key: 'previewRoot', default: () => resolve(projectRoot, 'build/deploy-preview') },
    'managed-root': { key: 'managedRoot', default: () => resolve(projectRoot, 'build/stage11-host/custom/content') }
  });
}

function requestPath(requestUrl) {
  const pathname = new URL(requestUrl, 'http://deployment-smoke.invalid').pathname;
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.htm';
  return safeRelativePath(decoded) ? decoded : null;
}

async function serve(root) {
  const server = createServer(async (request, response) => {
    const relative = requestPath(request.url ?? '/');
    if (!relative || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(relative ? 405 : 400).end();
      return;
    }
    const file = join(root, relative);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file');
      response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Deployment smoke server did not bind a TCP port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function assertSmokeRoot(root, manifestData, packageVersion) {
  await assertProjectBuildTarget(root, { roots: { projectRoot } });
  const state = await targetState(root, manifestData);
  if (!state.managed) throw new Error(`Deployment smoke root must have a valid ${markerName} marker: ${root}`);
  validateComponentContractArtifact(await readFile(join(root, componentContractPath)), packageVersion);
  return { root, state };
}

export async function runDeploymentSmoke(options) {
  const manifestData = await loadDeploymentManifest(resolve(projectRoot, 'deployment-manifest.json'));
  const packageVersion = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')).version;
  const previewDeployment = await assertSmokeRoot(resolve(options.previewRoot), manifestData, packageVersion);
  const managedDeployment = await assertSmokeRoot(resolve(options.managedRoot), manifestData, packageVersion);
  const assetPaths = previewDeployment.state.marker.files.filter((entry) => entry.path.startsWith('v2/')).map((entry) => entry.path);
  const managedAssetPaths = managedDeployment.state.marker.files.filter((entry) => entry.path.startsWith('v2/')).map((entry) => entry.path);
  if (assetPaths.join('\0') !== managedAssetPaths.join('\0')) throw new Error('Deployment smoke roots do not have the same V2 asset layout');
  const [preview, managed] = await Promise.all([serve(previewDeployment.root), serve(managedDeployment.root)]);
  try {
    await new Promise((resolveProcess, rejectProcess) => {
      const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', '--config', 'playwright.deployment.config.ts'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          DEPLOYMENT_SMOKE_PREVIEW_URL: preview.url,
          DEPLOYMENT_SMOKE_MANAGED_URL: managed.url,
          DEPLOYMENT_SMOKE_ASSETS: JSON.stringify(assetPaths),
          DEPLOYMENT_SMOKE_PACKAGE_VERSION: packageVersion
        },
        stdio: 'inherit'
      });
      child.once('error', rejectProcess);
      child.once('exit', (code, signal) => code === 0 ? resolveProcess() : rejectProcess(new Error(`Deployment smoke Playwright exited with ${signal ?? `code ${code}`}`)));
    });
  } finally {
    await Promise.all([new Promise((resolveClose) => preview.server.close(resolveClose)), new Promise((resolveClose) => managed.server.close(resolveClose))]);
  }
}

async function main() {
  await runDeploymentSmoke(parseDeploymentSmokeArgs(process.argv.slice(2)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
