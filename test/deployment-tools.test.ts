import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { deploy, parseDeployArgs } from '../scripts/deploy.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { deployCatalog, parseDeployCatalogArgs } from '../scripts/deploy-catalog.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { assertProjectBuildTarget, createDeploymentInventory, loadDeploymentManifest, markerName, projectRoot, targetState, verifyJavaHandoff } from '../scripts/deployment-contract.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { parseVerifyJavaHandoffArgs, runVerifyJavaHandoff } from '../scripts/verify-java-handoff.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { parseVerifyDeploymentInventoryArgs, runVerifyDeploymentInventory } from '../scripts/verify-deployment-inventory.mjs';
import { serializeComponentContract } from '../src/component-contract';

const execFileAsync = promisify(execFile);
const fixtureRoot = join(projectRoot, 'build', 'deployment-tools-test');
const buildRoot = join(fixtureRoot, 'build');
const source = join(fixtureRoot, 'source');
const target = join(buildRoot, 'stage11-host', 'custom', 'content');
const catalogTarget = join(buildRoot, 'stage11-host', 'nodes', 'Nodel Components Catalog', 'content');
const javaCheckout = join(fixtureRoot, 'java');
const manifestPath = join(projectRoot, 'deployment-manifest.json');
const roots = { projectRoot: fixtureRoot, buildRoot };

async function writeSource(root = source) {
  await mkdir(join(root, 'v2', 'chunks'), { recursive: true });
  await mkdir(join(root, 'v2', 'assets'), { recursive: true });
  await writeFile(join(root, 'components.html'), '<link href="v2/nodel-webui.css"><script type="module" src="/v2/nodel-webui.js"></script><video poster="v2/assets/poster.svg"></video><object data="v2/assets/object.svg"></object><img srcset="data:image/svg+xml,%3Csvg%2F%3E 1x, ./v2/assets/pixel.svg 1x, /v2/assets/pixel.svg 2x">\n');
  for (const page of ['index.htm', 'nodel.html', 'nodes.html', 'toolkit.html']) await writeFile(join(root, page), '<!doctype html>\n');
  // These are the static forms Vite emits for module chunks and preload maps.
  await writeFile(join(root, 'v2', 'nodel-webui.js'), 'import{boot}from"./chunks/main.js";export{boot as exported}from"./chunks/exported.js";import("./chunks/dynamic.js");new URL("./assets/pixel.svg",import.meta.url);new Worker("./chunks/worker.js");new SharedWorker(new URL("./chunks/shared-worker.js",import.meta.url));importScripts("./chunks/one.js", "./chunks/two.js");const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["chunks/preload.js","chunks/preload.css"])))=>i.map(i=>d[i]);import("package-name");export{value}from"external-package";\n//# sourceMappingURL=nodel-webui.js.map\n');
  await writeFile(join(root, 'v2', 'chunks', 'main.js'), 'export const boot = true;\n');
  await writeFile(join(root, 'v2', 'chunks', 'dynamic.js'), 'export {};\n');
  await writeFile(join(root, 'v2', 'chunks', 'exported.js'), 'export const boot = true;\n');
  await writeFile(join(root, 'v2', 'chunks', 'worker.js'), 'self.onmessage = () => {};\n');
  await writeFile(join(root, 'v2', 'chunks', 'shared-worker.js'), 'self.onconnect = () => {};\n');
  await writeFile(join(root, 'v2', 'chunks', 'one.js'), 'self.one = true;\n');
  await writeFile(join(root, 'v2', 'chunks', 'two.js'), 'self.two = true;\n');
  await writeFile(join(root, 'v2', 'chunks', 'preload.js'), 'export {};\n');
  await writeFile(join(root, 'v2', 'chunks', 'preload.css'), '.preload {}\n');
  await writeFile(join(root, 'v2', 'chunks', 'theme.css'), '.theme {}\n');
  await writeFile(join(root, 'v2', 'nodel-webui.css'), '@import "./chunks/theme.css"; body { background: url(./assets/pixel.svg); }\n');
  await writeFile(join(root, 'v2', 'assets', 'pixel.svg'), '<svg/>\n');
  await writeFile(join(root, 'v2', 'assets', 'poster.svg'), '<svg/>\n');
  await writeFile(join(root, 'v2', 'assets', 'object.svg'), '<svg/>\n');
  await writeFile(join(root, 'v2', 'nodel-webui.js.map'), '{}\n');
  await writeFile(join(root, 'v2', 'nodel-components.json'), serializeComponentContract('0.1.2'));
}

async function git(args: string[]) {
  await execFileAsync('git', ['-C', javaCheckout, ...args]);
}

async function commit(message: string) {
  await git(['add', '.']);
  await execFileAsync('git', ['-C', javaCheckout, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message]);
}

async function writeJavaFixture() {
  await mkdir(join(javaCheckout, 'nodel-webui-js', 'src'), { recursive: true });
  await writeFile(join(javaCheckout, 'nodel-webui-js', 'src', 'index.htm'), 'v1 index\n');
  await writeFile(join(javaCheckout, 'nodel-webui-js', 'src', 'legacy.html'), 'v1 legacy\n');
  await writeFile(join(javaCheckout, 'nodel-webui-js', 'Gruntfile.js'), 'module.exports = {};\n');
  await writeFile(join(javaCheckout, 'build.gradle'), 'plugins {}\n');
  await execFileAsync('git', ['init', '-b', 'dev', javaCheckout]);
  await commit('fixture');
  await git(['remote', 'add', 'origin', 'github:museumsvictoria/nodel']);
  await git(['branch', 'master']);
}

function deployOptions(overrides: Record<string, unknown> = {}) {
  return {
    source, target, javaCheckout, expectedJavaBranch: 'dev', manifest: manifestPath,
    dryRun: false, json: false, allowUnmanagedTarget: false, ...overrides
  } as ReturnType<typeof parseDeployArgs>;
}

describe('Stage 11 deployment tools', () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(buildRoot, { recursive: true });
    await writeSource();
    await writeJavaFixture();
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('rejects unsafe CLI forms, arbitrary Java branches, and catalog page selection', async () => {
    expect(() => parseDeployArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseDeployArgs(['--target'])).toThrow(/Missing value/);
    expect(() => parseDeployArgs(['--target', 'one', '--target', 'two'])).toThrow(/Duplicate argument/);
    expect(() => parseDeployArgs(['--java-checkout', '../nodel'])).toThrow(/expected-java-branch/);
    expect(() => parseDeployArgs(['--java-checkout', '../nodel', '--expected-java-branch', 'feature'])).toThrow(/dev or master/);
    expect(() => parseDeployCatalogArgs(['--page', 'nodes.html'])).toThrow(/Unknown argument/);
    expect(() => parseDeployCatalogArgs(['--target', target])).toThrow(/support-root/);
    expect(() => parseVerifyJavaHandoffArgs(['--json'])).toThrow(/java-checkout/);
  });

  it('records a complete, hash-backed V1 inventory and atomically writes optional evidence', async () => {
    const manifestData = await loadDeploymentManifest(manifestPath);
    const output = join(buildRoot, 'reports', 'java.json');
    const report = await runVerifyJavaHandoff({ javaCheckout, expectedBranch: 'dev', manifest: manifestPath, output, json: true });
    expect(report.repositoryRemote).toBe('github:museumsvictoria/nodel');
    expect(report.repository).toBe('museumsvictoria/nodel');
    expect(report.manifestSha256).toBe(manifestData.hash);
    expect(report.v1Files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'legacy.html', bytes: 10, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })]));
    expect(report.v1Directories).toEqual([]);
    expect(report.v1InventorySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.canonicalEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(report.canonicalEvidence)).not.toContain(javaCheckout);
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ commit: report.commit, manifestSha256: manifestData.hash });
    await git(['remote', 'set-url', 'origin', 'https://github.com/museumsvictoria/nodel.git']);
    expect((await verifyJavaHandoff({ javaCheckout, expectedBranch: 'dev', manifest: manifestData.manifest })).repository).toBe('museumsvictoria/nodel');
    await git(['remote', 'set-url', 'origin', 'git@github.com:museumsvictoria/nodel.git']);
    expect((await verifyJavaHandoff({ javaCheckout, expectedBranch: 'dev', manifest: manifestData.manifest })).repository).toBe('museumsvictoria/nodel');
    await git(['remote', 'set-url', 'origin', 'https://github.com/someone/else.git']);
    await expect(verifyJavaHandoff({ javaCheckout, expectedBranch: 'dev', manifest: manifestData.manifest })).rejects.toThrow(/canonical repository/);
    await expect(verifyJavaHandoff({ javaCheckout, expectedBranch: 'feature', manifest: manifestData.manifest })).rejects.toThrow(/dev or master/);
  });

  it('uses exclusive random temporary writes for Java evidence and catalog pages', async () => {
    const sentinel = join(fixtureRoot, 'sentinel.txt');
    await writeFile(sentinel, 'do not change\n');
    const guardedOperations = { lstat, mkdir, readFile, rename, rm, writeFile, randomUUID: () => 'known-collision' };

    const javaOutput = join(buildRoot, 'reports', 'guarded.json');
    const javaTemporary = join(dirname(javaOutput), '.guarded.json.tmp-known-collision');
    await mkdir(dirname(javaTemporary), { recursive: true });
    await symlink(sentinel, javaTemporary);
    await expect(runVerifyJavaHandoff({ javaCheckout, expectedBranch: 'dev', manifest: manifestPath, output: javaOutput, json: true }, { operations: guardedOperations })).rejects.toThrow(/temporary output already exists/);
    expect(await readFile(sentinel, 'utf8')).toBe('do not change\n');
    await rm(javaTemporary);

    await deploy(deployOptions(), { roots });
    const catalogTemporary = join(catalogTarget, '.components.html.catalog-known-collision');
    await mkdir(catalogTarget, { recursive: true });
    await symlink(sentinel, catalogTemporary);
    await expect(deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, {
      roots, operations: guardedOperations
    })).rejects.toThrow(/temporary page already exists/);
    expect(await readFile(sentinel, 'utf8')).toBe('do not change\n');
  });

  it('rejects Java structural collisions, aliases, and leaves Java sentinel files unchanged', async () => {
    const manifestData = await loadDeploymentManifest(manifestPath);
    const sentinel = join(javaCheckout, 'nodel-webui-js', 'src', 'legacy.html');
    const before = await readFile(sentinel, 'utf8');
    await writeFile(join(javaCheckout, 'nodel-webui-js', 'src', 'v2'), 'not a directory\n');
    await commit('structural collision');
    await expect(verifyJavaHandoff({ javaCheckout, manifest: manifestData.manifest })).rejects.toThrow(/structural/);
    expect(await readFile(sentinel, 'utf8')).toBe(before);
    await rm(join(javaCheckout, 'nodel-webui-js', 'src', 'v2'));
    await git(['add', '-u']);
    await execFileAsync('git', ['-C', javaCheckout, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'remove collision']);
    const alias = join(fixtureRoot, 'java-alias');
    await symlink(javaCheckout, alias);
    await expect(verifyJavaHandoff({ javaCheckout: alias, manifest: manifestData.manifest })).rejects.toThrow(/symlinks/);
  });

  it('uses canonical containment and rejects build-root and intermediate symlink escapes', async () => {
    const project = join(fixtureRoot, 'contained-project');
    const outside = join(fixtureRoot, 'outside');
    await mkdir(join(project, 'dist'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(project, 'build'));
    await expect(assertProjectBuildTarget(join(project, 'build', 'escape'), { source: join(project, 'dist'), roots: { projectRoot: project, buildRoot: join(project, 'build') } })).rejects.toThrow(/symlinks/);
    await rm(join(project, 'build'));
    await mkdir(join(project, 'build'), { recursive: true });
    await symlink(outside, join(project, 'build', 'nested'));
    await expect(assertProjectBuildTarget(join(project, 'build', 'nested', 'escape'), { source: join(project, 'dist'), roots: { projectRoot: project, buildRoot: join(project, 'build') } })).rejects.toThrow(/symlinks/);
    await rm(join(project, 'build', 'nested'));
    await symlink(outside, join(project, 'source-alias'));
    await expect(assertProjectBuildTarget(join(project, 'build', 'safe'), { source: join(project, 'source-alias'), roots: { projectRoot: project, buildRoot: join(project, 'build') } })).rejects.toThrow(/symlinks/);
  });

  it('validates canonical manifests, Vite reference forms, and control-path rejection', async () => {
    const manifestData = await loadDeploymentManifest(manifestPath);
    const inventory = await createDeploymentInventory(source, manifestData.manifest);
    expect(inventory.files).toContain('v2/chunks/dynamic.js');
    expect(inventory.files).toContain('v2/nodel-components.json');
    const invalidManifest = join(fixtureRoot, 'invalid-manifest.json');
    const text = await readFile(manifestPath, 'utf8');
    await writeFile(invalidManifest, text.replace('"components.html",', '"index.htm",\n      "components.html",'));
    await expect(loadDeploymentManifest(invalidManifest)).rejects.toThrow(/exactly the five stable/);
    await writeFile(invalidManifest, text.replace('mcartmel/nodel-webui-v2', 'someone/else'));
    await expect(loadDeploymentManifest(invalidManifest)).rejects.toThrow(/stable release pages|schemaVersion|manifest/);
    await writeFile(join(source, 'v2', 'bad\nname.js'), 'export {};\n');
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/Unsafe filesystem entry/);
  });

  it('requires a well-formed current component contract in the deployment inventory', async () => {
    const manifestData = await loadDeploymentManifest(manifestPath);
    await rm(join(source, 'v2', 'nodel-components.json'));
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/Missing component contract/);
    await writeSource();
    await writeFile(join(source, 'v2', 'nodel-components.json'), '{\n');
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/not valid JSON/);
    const wrongSchema = JSON.parse(serializeComponentContract('0.1.2'));
    wrongSchema.schemaVersion = 2;
    await writeFile(join(source, 'v2', 'nodel-components.json'), JSON.stringify(wrongSchema));
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/schemaVersion/);
    const wrongPackage = JSON.parse(serializeComponentContract('0.1.2'));
    wrongPackage.packageVersion = '0.0.0';
    await writeFile(join(source, 'v2', 'nodel-components.json'), JSON.stringify(wrongPackage));
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/packageVersion/);
    const malformedElement = JSON.parse(serializeComponentContract('0.1.2'));
    malformedElement.elements[0].attributes[0].completion = 'visible';
    await writeFile(join(source, 'v2', 'nodel-components.json'), JSON.stringify(malformedElement));
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/attributes\[0\]\.completion/);
    const emptyPhases = JSON.parse(serializeComponentContract('0.1.2'));
    emptyPhases.elements.find((element: { name: string }) => element.name === 'nodel-button').actionBindings[0].phases = [];
    await writeFile(join(source, 'v2', 'nodel-components.json'), JSON.stringify(emptyPhases));
    await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/phases.*non-empty/);
  });

  it('writes and checks a canonical, source-path-free dist inventory checkpoint', async () => {
    const output = join(projectRoot, 'build', 'deployment-tools-test-inventory.json');
    const writeOptions = { source, manifest: manifestPath, output, write: true, check: false, json: true };
    expect(() => parseVerifyDeploymentInventoryArgs(['--write', '--check'])).toThrow(/exactly one/);
    expect(() => parseVerifyDeploymentInventoryArgs(['--write', '--write'])).toThrow(/Duplicate argument/);
    const report = await runVerifyDeploymentInventory(writeOptions);
    expect(report).toMatchObject({
      schemaVersion: 1,
      deploymentManifest: { path: 'deployment-manifest.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      inventory: { algorithm: 'sha256', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }
    });
    expect(JSON.stringify(report)).not.toContain(source);
    await expect(runVerifyDeploymentInventory({ ...writeOptions, write: false, check: true })).resolves.toEqual(report);
    await writeFile(output, `${await readFile(output, 'utf8')}\n`);
    await expect(runVerifyDeploymentInventory({ ...writeOptions, write: false, check: true })).rejects.toThrow(/exactly match/);
    await runVerifyDeploymentInventory(writeOptions);
    await writeFile(join(source, 'components.html'), 'changed\n');
    await expect(runVerifyDeploymentInventory({ ...writeOptions, write: false, check: true })).rejects.toThrow(/exactly match/);
    await rm(output, { force: true });
  });

  it('rejects every expanded deployment reference form when its asset is missing', async () => {
    const manifestData = await loadDeploymentManifest(manifestPath);
    for (const file of [
      'v2/chunks/exported.js',
      'v2/chunks/worker.js',
      'v2/chunks/shared-worker.js',
      'v2/chunks/one.js',
      'v2/chunks/two.js',
      'v2/nodel-webui.js.map',
      'v2/chunks/preload.js',
      'v2/chunks/preload.css',
      'v2/assets/poster.svg',
      'v2/assets/object.svg'
    ]) {
      await rm(join(source, file));
      await expect(createDeploymentInventory(source, manifestData.manifest)).rejects.toThrow(/Missing referenced deployment asset/);
      await writeSource();
    }
  });

  it('accepts Vite production modulepreload dependency maps', async () => {
    await execFileAsync('npx', ['vite', 'build'], { cwd: projectRoot });
    const manifestData = await loadDeploymentManifest(manifestPath);
    const inventory = await createDeploymentInventory(join(projectRoot, 'dist'), manifestData.manifest);
    expect(inventory.files.some((file: string) => file.startsWith('v2/chunks/main-'))).toBe(true);
  }, 15_000);

  it('rejects forged, truncated, and drifted managed markers', async () => {
    await deploy(deployOptions(), { roots });
    const markerPath = join(target, markerName);
    await writeFile(markerPath, '{\n');
    const manifestData = await loadDeploymentManifest(manifestPath);
    await expect(targetState(target, manifestData)).rejects.toThrow(/Invalid managed/);
    await rm(target, { recursive: true });
    await deploy(deployOptions(), { roots });
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { files: unknown[] };
    marker.files = marker.files.slice(1);
    await writeFile(markerPath, `${JSON.stringify(marker)}\n`);
    await expect(targetState(target, manifestData)).rejects.toThrow(/inventory hash|exactly match/);
    await rm(target, { recursive: true });
    await deploy(deployOptions(), { roots });
    await writeFile(join(target, 'foreign.txt'), 'drift\n');
    await expect(targetState(target, manifestData)).rejects.toThrow(/exactly match/);
  });

  it('detects source swaps, target substitutions, and parent symlink injection before cutover', async () => {
    await deploy(deployOptions(), { roots });
    const old = await readFile(join(target, 'components.html'), 'utf8');
    await expect(deploy(deployOptions(), { roots, hooks: { beforeCutover: async () => writeFile(join(source, 'components.html'), 'changed after inventory\n') } })).rejects.toThrow(/source changed/);
    expect(await readFile(join(target, 'components.html'), 'utf8')).toBe(old);
    await writeSource();
    await expect(deploy(deployOptions(), { roots, hooks: { beforeCutover: async () => { await rm(target, { recursive: true }); await mkdir(target, { recursive: true }); } } })).rejects.toThrow(/created, substituted, or modified/);
    await deploy(deployOptions({ allowUnmanagedTarget: true }), { roots });
    const custom = dirname(target);
    const outside = join(fixtureRoot, 'outside-parent');
    await mkdir(outside, { recursive: true });
    await expect(deploy(deployOptions(), { roots, hooks: { beforeCutover: async () => { await rm(custom, { recursive: true }); await symlink(outside, custom); } } })).rejects.toThrow(/symlinks/);
  });

  it('aborts when a hook changes the staged marker, tree, or page', async () => {
    await deploy(deployOptions(), { roots });
    const old = await readFile(join(target, 'components.html'), 'utf8');
    await expect(deploy(deployOptions(), {
      roots,
      hooks: {
        beforeCutover: async ({ stage }: { stage: string }) => {
          const marker = JSON.parse(await readFile(join(stage, markerName), 'utf8'));
          await writeFile(join(stage, markerName), JSON.stringify(marker));
        }
      }
    })).rejects.toThrow(/marker/);
    await expect(deploy(deployOptions(), { roots, hooks: { beforeCutover: async ({ stage }: { stage: string }) => writeFile(join(stage, 'foreign.txt'), 'foreign\n') } })).rejects.toThrow(/exactly match/);
    await expect(deploy(deployOptions(), { roots, hooks: { beforeCutover: async ({ stage }: { stage: string }) => writeFile(join(stage, 'components.html'), 'changed\n') } })).rejects.toThrow(/marker|file does not match/);
    expect(await readFile(join(target, 'components.html'), 'utf8')).toBe(old);
  });

  it('requires stable Java branch and V1 evidence immediately before cutover', async () => {
    await deploy(deployOptions(), { roots });
    const old = await readFile(join(target, 'components.html'), 'utf8');
    await expect(deploy(deployOptions(), { roots, hooks: { beforeCutover: async () => git(['checkout', 'master']) } })).rejects.toThrow(/expected dev/);
    await git(['checkout', 'dev']);
    await expect(deploy(deployOptions(), {
      roots,
      hooks: { beforeCutover: async () => writeFile(join(javaCheckout, 'nodel-webui-js', 'src', 'legacy.html'), 'mutated\n') }
    })).rejects.toThrow(/not clean/);
    expect(await readFile(join(target, 'components.html'), 'utf8')).toBe(old);
  });

  it('restores the old target if the second rename fails', async () => {
    await deploy(deployOptions(), { roots });
    await writeFile(join(source, 'components.html'), '<script src="/v2/nodel-webui.js"></script>new\n');
    let calls = 0;
    const operations = {
      copyFile, lstat, mkdir, rename: async (from: string, to: string) => {
        calls += 1;
        if (calls === 2) throw new Error('simulated second rename failure');
        return rename(from, to);
      }, rm, writeFile
    };
    await expect(deploy(deployOptions(), { roots, operations })).rejects.toThrow(/previous target was restored/);
    expect(await readFile(join(target, 'components.html'), 'utf8')).not.toContain('new');
  });

  it('restores the old target when the staged tree changes after the target moves', async () => {
    await deploy(deployOptions(), { roots });
    const old = await readFile(join(target, 'components.html'), 'utf8');
    await writeFile(join(source, 'components.html'), '<script src="/v2/nodel-webui.js"></script>new\n');
    let stage = '';
    let stageMutated = false;
    const operations = {
      copyFile, lstat, mkdir, rename: async (from: string, to: string) => {
        await rename(from, to);
        if (from === target) {
          await writeFile(join(stage, 'components.html'), 'mutated after target move\n');
          stageMutated = true;
        }
      }, rm, writeFile
    };
    await expect(deploy(deployOptions(), {
      roots,
      operations,
      hooks: { beforeCutover: ({ stage: cutoverStage }: { stage: string }) => { stage = cutoverStage; } }
    })).rejects.toThrow(/previous target was restored: Managed deployment file does not match marker/);
    expect(stageMutated).toBe(true);
    expect(await readFile(join(target, 'components.html'), 'utf8')).toBe(old);
  });

  it('requires a complete matching support deployment for catalog copies', async () => {
    await expect(deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: true, json: false }, { roots })).rejects.toThrow(/complete managed/);
    await deploy(deployOptions(), { roots });
    const report = await deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, { roots });
    expect(report.page).toBe('components.html');
    expect(await readFile(join(catalogTarget, 'components.html'), 'utf8')).toContain('nodel-webui');
    await writeFile(join(source, 'components.html'), 'stale\n');
    await expect(deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: true, json: false }, { roots })).rejects.toThrow(/does not match/);
  });

  it('rejects catalog parent-child root overlap before making target directories', async () => {
    await deploy(deployOptions(), { roots });
    const nestedTarget = join(target, 'catalog-child');
    await expect(deployCatalog({ source, target: nestedTarget, supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, { roots })).rejects.toThrow(/contain one another/);
    await expect(lstat(nestedTarget)).rejects.toThrow();
    await expect(deployCatalog({ source, target: dirname(target), supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, { roots })).rejects.toThrow(/contain one another/);
  });

  it('keeps catalog target identity stable through its cutover', async () => {
    await deploy(deployOptions(), { roots });
    await expect(deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, {
      roots,
      hooks: { beforeCutover: async () => writeFile(join(catalogTarget, 'components.html'), 'substituted\n') }
    })).rejects.toThrow(/substituted or modified/);
  });

  it('rehashes the catalog page after its cutover hook', async () => {
    await deploy(deployOptions(), { roots });
    await expect(deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, {
      roots,
      hooks: { beforeCutover: async ({ temporary }: { temporary: string }) => writeFile(temporary, 'mutated\n') }
    })).rejects.toThrow(/changed after validation/);
    await expect(lstat(join(catalogTarget, 'components.html'))).rejects.toThrow();
  });

  it('rehashes the catalog page after its final pre-rename hook', async () => {
    await deploy(deployOptions(), { roots });
    let temporaryMutated = false;
    await expect(deployCatalog({ source, target: catalogTarget, supportRoot: target, manifest: manifestPath, dryRun: false, json: false }, {
      roots,
      hooks: {
        beforeRename: async ({ temporary }: { temporary: string }) => {
          await writeFile(temporary, 'mutated in final window\n');
          temporaryMutated = true;
        }
      }
    })).rejects.toThrow(/changed after validation/);
    expect(temporaryMutated).toBe(true);
    await expect(lstat(join(catalogTarget, 'components.html'))).rejects.toThrow();
  });

  it('keeps package deployment aliases self-contained and branch pinned', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['deploy:test']).toContain('--expected-java-branch dev');
    expect(packageJson.scripts['deploy:catalog:test']).toContain('deploy.mjs');
    expect(packageJson.scripts['deploy:catalog:test']).toContain('--support-root');
    expect(packageJson.scripts['deploy:catalog:preview']).toContain('deploy.mjs');
    expect(packageJson.scripts['deploy:catalog:preview']).toContain('--support-root');
  });
});
