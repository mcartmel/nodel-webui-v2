import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
// @ts-expect-error Release scripts are intentionally plain Node ESM.
import { parsePrepareReleaseArgs } from '../scripts/prepare-release.mjs';
// @ts-expect-error Release scripts are intentionally plain Node ESM.
import { prepareRelease, resolveReleaseOptions, validateReleaseBundle, verifyReleaseBundle } from '../scripts/release-contract.mjs';
// @ts-expect-error Release scripts are intentionally plain Node ESM.
import { verifyReleaseArchive } from '../scripts/verify-release-archive.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { createDeploymentInventory, loadDeploymentManifest } from '../scripts/deployment-contract.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { runVerifyDeploymentInventory } from '../scripts/verify-deployment-inventory.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { runVerifyJavaHandoff } from '../scripts/verify-java-handoff.mjs';
import { serializeComponentContract } from '../src/component-contract';
// @ts-expect-error Security scripts are intentionally plain Node ESM.
import { generateDependencyEvidence } from '../scripts/dependency-evidence.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const fixtureRoot = join(projectRoot, 'build', 'prepare-release-test');
const source = join(fixtureRoot, 'dist');
const target = join(fixtureRoot, 'build', 'release');
const javaCheckout = join(fixtureRoot, 'java');

async function git(args: string[]) {
  return execFileAsync('git', ['-C', fixtureRoot, ...args]);
}

async function writeSource() {
  await mkdir(join(source, 'v2', 'chunks'), { recursive: true });
  await mkdir(join(source, 'v2', 'assets'), { recursive: true });
  await writeFile(join(source, 'components.html'), '<link href="./v2/nodel-webui.css"><script type="module" src="./v2/nodel-webui.js"></script>\n');
  for (const file of ['index.htm', 'nodel.html', 'nodes.html', 'toolkit.html']) {
    await writeFile(join(source, file), '<!doctype html>\n');
  }
  await writeFile(join(source, 'v2', 'nodel-webui.js'), 'import{main as m}from"./chunks/main.js";m();\n');
  await writeFile(join(source, 'v2', 'chunks', 'main.js'), 'export const main=()=>{}\n');
  await writeFile(join(source, 'v2', 'nodel-webui.css'), 'body { background: url("./assets/pixel.svg"); }\n');
  await writeFile(join(source, 'v2', 'assets', 'pixel.svg'), '<svg/>\n');
  await writeFile(join(source, 'v2', 'nodel-components.json'), serializeComponentContract('0.1.1'));
}

async function writeFixtureProject() {
  await mkdir(join(fixtureRoot, 'docs'), { recursive: true });
  await mkdir(join(fixtureRoot, 'security'), { recursive: true });
  await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
    name: 'nodel-webui-v2', version: '0.1.1', repository: 'github:mcartmel/nodel-webui-v2'
  }, null, 2));
  await writeFile(join(fixtureRoot, '.gitignore'), 'build/\njava/\n');
  await writeFile(join(fixtureRoot, 'LICENSE'), 'license\n');
  await writeFile(join(fixtureRoot, 'THIRD-PARTY-NOTICES.md'), '# Third-Party Notices\n\n| Package | License |\n| --- | --- |\n| `fixture-package` | MIT |\n');
  await writeFile(join(fixtureRoot, 'package-lock.json'), JSON.stringify({
    name: 'nodel-webui-v2', version: '0.1.1', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'nodel-webui-v2', version: '0.1.1', license: 'MPL-2.0', dependencies: { 'fixture-package': '1.0.0' } },
      'node_modules/fixture-package': { version: '1.0.0', resolved: 'https://registry.example.invalid/fixture-package/-/fixture-package-1.0.0.tgz', integrity: 'sha512-Zml4dHVyZS1wYWNrYWdl', license: 'MIT' }
    }
  }, null, 2) + '\n');
  await writeFile(join(fixtureRoot, 'security', 'license-policy.json'), '{\n  "schemaVersion": 1,\n  "allowedLicenses": ["MIT"],\n  "noticeRequired": true\n}\n');
  await writeFile(join(fixtureRoot, 'RELEASE_NOTES.md'), 'notes\n');
  await writeFile(join(fixtureRoot, 'docs', 'release-handoff.md'), 'handoff\n');
  await writeFile(join(fixtureRoot, 'deployment-manifest.json'), await readFile(join(projectRoot, 'deployment-manifest.json'), 'utf8'));
  await writeSource();
  await writeDependencyEvidence();
  await execFileAsync('git', ['init', '-b', 'main', fixtureRoot]);
  await git(['add', '.']);
  await execFileAsync('git', ['-C', fixtureRoot, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
  await git(['remote', 'add', 'origin', 'https://github.com/mcartmel/nodel-webui-v2.git']);
  await git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
}

async function writeDependencyEvidence() {
  const evidence = await generateDependencyEvidence({ projectRoot: fixtureRoot });
  await mkdir(join(fixtureRoot, 'build', 'dependency-evidence'), { recursive: true });
  await writeFile(join(fixtureRoot, 'build', 'dependency-evidence', 'SBOM.cdx.json'), evidence.files.sbom);
  await writeFile(join(fixtureRoot, 'build', 'dependency-evidence', 'THIRD-PARTY-LICENSES.json'), evidence.files.licenses);
}

async function writeJavaFixture() {
  await mkdir(join(javaCheckout, 'nodel-webui-js', 'src'), { recursive: true });
  await writeFile(join(javaCheckout, 'nodel-webui-js', 'src', 'index.htm'), 'legacy index\n');
  await writeFile(join(javaCheckout, 'nodel-webui-js', 'src', 'legacy.html'), 'legacy page\n');
  await writeFile(join(javaCheckout, 'nodel-webui-js', 'Gruntfile.js'), 'module.exports = {};\n');
  await writeFile(join(javaCheckout, 'build.gradle'), 'plugins {}\n');
  await execFileAsync('git', ['init', '-b', 'dev', javaCheckout]);
  await execFileAsync('git', ['-C', javaCheckout, 'add', '.']);
  await execFileAsync('git', ['-C', javaCheckout, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
  await execFileAsync('git', ['-C', javaCheckout, 'remote', 'add', 'origin', 'github:museumsvictoria/nodel']);
  await execFileAsync('git', ['-C', javaCheckout, 'branch', 'master']);
}

async function actualJavaReports() {
  const dev = join(fixtureRoot, 'build', 'reports', 'dev-java.json');
  const master = join(fixtureRoot, 'build', 'reports', 'master-java.json');
  await runVerifyJavaHandoff({ javaCheckout, expectedBranch: 'dev', manifest: join(fixtureRoot, 'deployment-manifest.json'), output: dev, json: true });
  await execFileAsync('git', ['-C', javaCheckout, 'switch', 'master']);
  await runVerifyJavaHandoff({ javaCheckout, expectedBranch: 'master', manifest: join(fixtureRoot, 'deployment-manifest.json'), output: master, json: true });
  await execFileAsync('git', ['-C', javaCheckout, 'switch', 'dev']);
  return { dev, master };
}

async function taggedOptions(overrides: Record<string, unknown> = {}) {
  const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const epoch = (await git(['show', '-s', '--format=%ct', 'HEAD'])).stdout.trim();
  const { dev, master } = await actualJavaReports();
  const distInventory = join(fixtureRoot, 'build', 'dist-inventory.json');
  await runVerifyDeploymentInventory({ source, manifest: join(fixtureRoot, 'deployment-manifest.json'), output: distInventory, write: true, check: false, json: true }, { projectRoot: fixtureRoot });
  return options({
    tag: 'v0.1.1', commit, branch: 'main', sourceDateEpoch: epoch,
    javaDevReport: dev, javaMasterReport: master,
    ciRunUrl: 'https://github.com/mcartmel/nodel-webui-v2/actions/runs/123', approvalEnvironment: 'production-release',
    distInventory,
    provided: new Set(['tag', 'commit', 'branch', 'source-date-epoch', 'dist-inventory', 'java-dev-report', 'java-master-report', 'ci-run-url', 'approval-environment']),
    ...overrides
  });
}

async function options(overrides: Record<string, unknown> = {}): Promise<Record<string, any>> {
  return {
    source,
    target,
    force: false,
    json: false,
    quiet: false,
    provided: new Set<string>(),
    ...overrides
  };
}

async function release(overrides: Record<string, unknown> = {}) {
  return prepareRelease(await options(overrides), { projectRoot: fixtureRoot });
}

describe('prepare-release', () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await writeFixtureProject();
    await writeJavaFixture();
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('strictly parses the release CLI arguments', () => {
    expect(() => parsePrepareReleaseArgs(['--unknown'])).toThrow(/Unknown argument/);
    expect(() => parsePrepareReleaseArgs(['--target'])).toThrow(/Missing value/);
    expect(() => parsePrepareReleaseArgs(['--force', '--force'])).toThrow(/Duplicate argument/);
    expect(() => parsePrepareReleaseArgs(['dist'])).toThrow(/positional/);
    expect(() => parsePrepareReleaseArgs(['--json', '--quiet'])).toThrow(/cannot be used together/);
  });

  it('creates a schema 5 bundle with dependency evidence and exact hashes', async () => {
    const derived = await resolveReleaseOptions(await options(), { projectRoot: fixtureRoot });
    expect(derived.sourceDateEpoch).toBe(Number((await git(['show', '-s', '--format=%ct', 'HEAD'])).stdout.trim()));
    const epoch = (await git(['show', '-s', '--format=%ct', 'HEAD'])).stdout.trim();
    const report = await release({ sourceDateEpoch: epoch });
    const manifest = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
    const output = await readdir(target);
    const manifestData = await loadDeploymentManifest(join(fixtureRoot, 'deployment-manifest.json'));

    expect(report).toMatchObject({ dirty: false, publishable: false, sourceDateEpoch: Number(epoch) });
    expect(manifest).toMatchObject({
       schemaVersion: 5,
      name: 'nodel-webui-v2',
      version: '0.1.1',
      source: { repository: 'mcartmel/nodel-webui-v2', branch: 'main', tag: null, dirty: false, publishable: false },
      sourceDateEpoch: Number(epoch),
      nodelApi: { min: '1.0', maxExclusive: '2.0' },
       deploymentManifest: {
        path: 'deployment-manifest.json', sha256: manifestData.hash, defaultV1Policy: 'preserve',
        javaTargets: { dev: 'prerelease', master: 'stable' }
       },
       componentContract: { path: 'v2/nodel-components.json', schemaVersion: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
       dependencyEvidence: {
         lockSha256: expect.stringMatching(/^[0-9a-f]{64}$/), policySha256: expect.stringMatching(/^[0-9a-f]{64}$/), noticeSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
         sbom: { path: 'SBOM.cdx.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
         licenses: { path: 'THIRD-PARTY-LICENSES.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }
       },
      releaseProcess: { ciRunUrl: null, approvalEnvironment: null, distInventorySha256: null },
      javaEvidence: { available: false, targets: null },
      inventoryAlgorithm: 'sha256',
      inventoryExcludes: ['release.json']
    });
    expect(output.sort()).toEqual([
       'LICENSE', 'PRODUCTION_HANDOFF.md', 'RELEASE_NOTES.md', 'SBOM.cdx.json', 'THIRD-PARTY-LICENSES.json', 'THIRD-PARTY-NOTICES.md',
      'components.html', 'deployment-manifest.json', 'index.htm', 'nodel.html', 'nodes.html',
      'release.json', 'toolkit.html', 'v2'
    ]);
    expect(manifest.files.map((entry: { path: string }) => entry.path)).toEqual([
       'LICENSE', 'PRODUCTION_HANDOFF.md', 'RELEASE_NOTES.md', 'SBOM.cdx.json', 'THIRD-PARTY-LICENSES.json', 'THIRD-PARTY-NOTICES.md',
      'components.html', 'deployment-manifest.json', 'index.htm', 'nodel.html', 'nodes.html',
       'toolkit.html', 'v2/assets/pixel.svg', 'v2/chunks/main.js', 'v2/nodel-components.json', 'v2/nodel-webui.css', 'v2/nodel-webui.js'
    ]);
    expect(manifest.files.some((entry: { path: string }) => entry.path === 'release.json')).toBe(false);
    for (const entry of manifest.files as Array<{ path: string; bytes: number; sha256: string }>) {
      const content = await readFile(join(target, entry.path));
      expect((await stat(join(target, entry.path))).size).toBe(entry.bytes);
      expect(createHash('sha256').update(content).digest('hex')).toBe(entry.sha256);
    }
    await expect(readFile(join(target, 'PRODUCTION_HANDOFF.md'), 'utf8')).resolves.toBe('handoff\n');
  });

  it('requires matching version, full current commit, tag, and main branch for tagged releases', async () => {
    const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await git(['tag', 'v0.1.1']);
    await expect(release(await taggedOptions())).resolves.toMatchObject({ publishable: true, dirty: false });
    await expect(resolveReleaseOptions(await options({ version: '0.1.2' }), { projectRoot: fixtureRoot })).rejects.toThrow(/does not match/);
    await expect(resolveReleaseOptions(await options({ commit: 'not-a-commit' }), { projectRoot: fixtureRoot })).rejects.toThrow(/full lowercase git commit/);
    await expect(resolveReleaseOptions(await options({ repository: 'github:someone/else' }), { projectRoot: fixtureRoot })).rejects.toThrow(/canonical deployment manifest repository/);
    await expect(resolveReleaseOptions(await options({ sourceDateEpoch: '1' }), { projectRoot: fixtureRoot })).rejects.toThrow(/commit timestamp/);
    await expect(resolveReleaseOptions(await options({ tag: 'v0.1.1', commit }), { projectRoot: fixtureRoot })).rejects.toThrow(/explicit --commit/);
    await expect(resolveReleaseOptions(await options({ tag: 'v0.1.2', commit, provided: new Set(['tag', 'commit']) }), { projectRoot: fixtureRoot })).rejects.toThrow(/exactly match/);
    await expect(resolveReleaseOptions(await taggedOptions(), { projectRoot: fixtureRoot })).resolves.toMatchObject({ tag: 'v0.1.1' });
    await git(['checkout', '-b', 'release']);
    await expect(resolveReleaseOptions(await taggedOptions({ branch: 'release' }), { projectRoot: fixtureRoot })).rejects.toThrow(/branch main/);
    await git(['checkout', 'main']);
    await git(['update-ref', '-d', 'refs/remotes/origin/main']);
    await expect(resolveReleaseOptions(await taggedOptions(), { projectRoot: fixtureRoot })).rejects.toThrow(/refs\/remotes\/origin\/main/);
    await git(['update-ref', 'refs/remotes/origin/main', commit]);
  });

  it('accepts an explicit main provenance branch from a detached tagged CI checkout', async () => {
    const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await git(['tag', 'v0.1.1']);
    await git(['checkout', '--detach', commit]);

    await expect(resolveReleaseOptions(await taggedOptions({ commit }), { projectRoot: fixtureRoot })).resolves.toMatchObject({ branch: 'main', tag: 'v0.1.1' });
  });

  it('records dirty local rehearsals as non-publishable and rejects dirty tagged releases', async () => {
    await writeFile(join(fixtureRoot, 'RELEASE_NOTES.md'), 'changed\n');
    await expect(release()).resolves.toMatchObject({ dirty: true, publishable: false });
    await rm(target, { recursive: true });
    await git(['tag', 'v0.1.1']);
    await expect(release(await taggedOptions())).rejects.toThrow(/clean tracked and untracked/);
  });

  it('refuses non-empty targets unless forced and preserves them when stage assembly fails', async () => {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'old.txt'), 'old\n');
    await expect(release()).rejects.toThrow(/non-empty/);
    await expect(release({ force: true })).resolves.toMatchObject({ fileCount: expect.any(Number) });
    await writeFile(join(target, 'old.txt'), 'old\n');
    await rm(join(fixtureRoot, 'RELEASE_NOTES.md'));
    await expect(release({ force: true })).rejects.toThrow(/handoff file/);
    await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old\n');
  });

  it('rejects unsafe, unexpected, incomplete, and symlinked deployment sources', async () => {
    await expect(release({ target: source })).rejects.toThrow(/below the project build directory|must not contain/);
    await writeFile(join(source, 'unexpected.txt'), 'no\n');
    await expect(release()).rejects.toThrow(/Unexpected top-level/);
    await rm(join(source, 'unexpected.txt'));
    await rm(join(source, 'v2', 'chunks', 'main.js'));
    await expect(release()).rejects.toThrow(/Missing referenced/);
    await writeFile(join(source, 'v2', 'chunks', 'main.js'), 'export {}\n');
    await symlink('nodel-webui.js', join(source, 'v2', 'linked.js'));
    await expect(release()).rejects.toThrow(/Symlinks/);
  });

  it('requires the deployment manifest to retain exactly five stable release pages', async () => {
    const manifestPath = join(fixtureRoot, 'deployment-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.artifact.stableEntries.pop();
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(release()).rejects.toThrow(/exactly the five stable release pages/);
  });

  it('is deterministic and detects corrupt bundled content', async () => {
    const first = join(fixtureRoot, 'build', 'one');
    const second = join(fixtureRoot, 'build', 'two');
    const epoch = (await git(['show', '-s', '--format=%ct', 'HEAD'])).stdout.trim();
    await prepareRelease(await options({ target: first, sourceDateEpoch: epoch }), { projectRoot: fixtureRoot });
    await prepareRelease(await options({ target: second, sourceDateEpoch: epoch }), { projectRoot: fixtureRoot });
    const firstManifest = await readFile(join(first, 'release.json'));
    const secondManifest = await readFile(join(second, 'release.json'));
    expect(firstManifest.equals(secondManifest)).toBe(true);

    const resolved = await resolveReleaseOptions(await options({ target: first, sourceDateEpoch: epoch }), { projectRoot: fixtureRoot });
    const manifestData = await loadDeploymentManifest(join(fixtureRoot, 'deployment-manifest.json'));
    const inventory = await createDeploymentInventory(source, manifestData.manifest, { packageVersion: '0.1.1' });
    const bundleManifest = JSON.parse(await readFile(join(first, 'release.json'), 'utf8'));
    const expected = {
      name: resolved.packageMetadata.name, version: resolved.version, commit: resolved.commit,
      repository: resolved.repository, branch: resolved.branch, tag: resolved.tag, dirty: resolved.dirty,
      publishable: false, sourceDateEpoch: resolved.sourceDateEpoch, deploymentManifestHash: manifestData.hash,
       componentContract: bundleManifest.componentContract, dependencyEvidence: bundleManifest.dependencyEvidence, ciRunUrl: null, approvalEnvironment: null, distInventorySha256: null, javaEvidence: bundleManifest.javaEvidence,
      filesInventorySha256: createHash('sha256').update(JSON.stringify(bundleManifest.files)).digest('hex')
    };
    await writeFile(join(first, 'unexpected.txt'), 'unexpected\n');
    await expect(validateReleaseBundle(first, expected, inventory.files)).rejects.toThrow(/unexpected or unlisted/);
    await rm(join(first, 'unexpected.txt'));
    await writeFile(join(first, 'v2', 'chunks', 'main.js'), 'corrupt\n');
    await expect(validateReleaseBundle(first, expected, inventory.files)).rejects.toThrow(/hash or size/);
    await prepareRelease(await options({ target: first, sourceDateEpoch: epoch, force: true }), { projectRoot: fixtureRoot });
    await writeFile(join(first, 'v2', 'nodel-components.json'), `${serializeComponentContract('0.1.1')}\n`);
    await expect(verifyReleaseBundle(first)).rejects.toThrow(/component contract hash|inventory hash or size/);
    await prepareRelease(await options({ target: first, sourceDateEpoch: epoch, force: true }), { projectRoot: fixtureRoot });
    const wrongSchema = JSON.parse(serializeComponentContract('0.1.1'));
    wrongSchema.schemaVersion = 2;
    await writeFile(join(first, 'v2', 'nodel-components.json'), JSON.stringify(wrongSchema));
    await expect(verifyReleaseBundle(first)).rejects.toThrow(/schemaVersion|inventory hash or size/);
    await prepareRelease(await options({ target: first, sourceDateEpoch: epoch, force: true }), { projectRoot: fixtureRoot });
    const wrongPackage = JSON.parse(serializeComponentContract('0.1.1'));
    wrongPackage.packageVersion = '0.0.0';
    await writeFile(join(first, 'v2', 'nodel-components.json'), JSON.stringify(wrongPackage));
    await expect(verifyReleaseBundle(first)).rejects.toThrow(/packageVersion|inventory hash or size/);
    await prepareRelease(await options({ target: first, sourceDateEpoch: epoch, force: true }), { projectRoot: fixtureRoot });
    const malformed = JSON.parse(serializeComponentContract('0.1.1'));
    malformed.elements[0].attributes[0].lifecycle = 'sometimes';
    const malformedContent = `${JSON.stringify(malformed)}\n`;
    await writeFile(join(first, 'v2', 'nodel-components.json'), malformedContent);
    const releaseManifest = JSON.parse(await readFile(join(first, 'release.json'), 'utf8'));
    const malformedHash = createHash('sha256').update(malformedContent).digest('hex');
    releaseManifest.componentContract.sha256 = malformedHash;
    const contractEntry = releaseManifest.files.find((entry: { path: string }) => entry.path === 'v2/nodel-components.json');
    contractEntry.bytes = Buffer.byteLength(malformedContent);
    contractEntry.sha256 = malformedHash;
    await writeFile(join(first, 'release.json'), JSON.stringify(releaseManifest));
    await expect(verifyReleaseBundle(first)).rejects.toThrow(/lifecycle/);
  }, 15_000);

  it('rejects source, handoff, and target substitutions before cutover', async () => {
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async () => writeFile(join(source, 'v2', 'chunks', 'main.js'), 'changed\n') }
    })).rejects.toThrow(/Captured deployment entry changed/);
    await writeFile(join(source, 'v2', 'chunks', 'main.js'), 'export const main=()=>{}\n');
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async () => writeFile(join(fixtureRoot, 'RELEASE_NOTES.md'), 'swapped\n') }
    })).rejects.toThrow(/handoff file changed after capture/);
    await writeFile(join(fixtureRoot, 'RELEASE_NOTES.md'), 'notes\n');
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async () => { await mkdir(target, { recursive: true }); await writeFile(join(target, 'racer'), 'x'); } }
    })).rejects.toThrow(/target changed after ownership/);
  });

  it('requires deterministic source evidence and rejects staged evidence substitution', async () => {
    await rm(join(fixtureRoot, 'build', 'dependency-evidence', 'SBOM.cdx.json'));
    await expect(release()).rejects.toThrow(/Dependency evidence must be a regular file/);
    await writeDependencyEvidence();
    await writeFile(join(fixtureRoot, 'build', 'dependency-evidence', 'THIRD-PARTY-LICENSES.json'), '{}\n');
    await expect(release()).rejects.toThrow(/SBOM|license|stale|substituted|binding/i);
    await writeDependencyEvidence();
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async ({ stage }: { stage: string }) => writeFile(join(stage, 'SBOM.cdx.json'), '{}\n') }
    })).rejects.toThrow(/hash or size|SBOM|dependency evidence/i);
  });

  it('revalidates the complete stage and target immediately before each rename', async () => {
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async ({ stage }: { stage: string }) => writeFile(join(stage, 'release.json'), 'changed\n') }
    })).rejects.toThrow(/release\.json is not valid JSON/);
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async ({ stage }: { stage: string }) => mkdir(join(stage, 'foreign-directory')) }
    })).rejects.toThrow(/directories do not exactly match/);
    await git(['tag', 'v0.1.1']);
    await expect(prepareRelease(await taggedOptions(), {
      projectRoot: fixtureRoot,
      hooks: { beforeCutover: async ({ stage }: { stage: string }) => writeFile(join(stage, 'java-handoff', 'dev.json'), 'changed\n') }
    })).rejects.toThrow(/hash or size does not match/);

    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeFirstRename: async () => { await mkdir(target, { recursive: true }); await writeFile(join(target, 'racer'), 'x'); } }
    })).rejects.toThrow(/target changed after ownership/);
    await rm(target, { recursive: true });
    await expect(prepareRelease(await options(), {
      projectRoot: fixtureRoot,
      hooks: { beforeSecondRename: async () => mkdir(target, { recursive: true }) }
    })).rejects.toThrow(/created or substituted before the final rename/);
    await rm(target, { recursive: true });

    const nestedTarget = join(fixtureRoot, 'build', 'nested', 'release');
    const outside = join(fixtureRoot, 'outside');
    await expect(prepareRelease(await options({ target: nestedTarget }), {
      projectRoot: fixtureRoot,
      hooks: {
        beforeFirstRename: async () => {
          await rm(join(fixtureRoot, 'build', 'nested'), { recursive: true });
          await mkdir(outside, { recursive: true });
          await symlink(outside, join(fixtureRoot, 'build', 'nested'));
        }
      }
    })).rejects.toThrow(/symlinks/);
  });

  it('rejects release, handoff, Java-report, and extra-file mutations at every final-stage hook', async () => {
    await git(['tag', 'v0.1.1']);
    const mutations: Array<[string, (stage: string) => Promise<void>]> = [
      ['release.json', (stage) => writeFile(join(stage, 'release.json'), 'forged\n')],
      ['handoff', (stage) => writeFile(join(stage, 'RELEASE_NOTES.md'), 'forged\n')],
      ['Java report', (stage) => writeFile(join(stage, 'java-handoff', 'dev.json'), 'forged\n')],
      ['extra file', (stage) => writeFile(join(stage, 'forged.txt'), 'forged\n')]
    ];
    for (const hookName of ['beforeCutover', 'beforeFirstRename', 'beforeSecondRename']) {
      for (const [, mutate] of mutations) {
        let stageMutated = false;
        await expect(prepareRelease(await taggedOptions(), {
          projectRoot: fixtureRoot,
          hooks: {
            [hookName]: async ({ target: hookTarget, stage, backup }: { target: string; stage: string; backup?: string }) => {
              expect(hookTarget).toBe(target);
              if (hookName !== 'beforeCutover') expect(backup).toMatch(/\.release\.backup-/);
              await mutate(stage);
              stageMutated = true;
            }
          }
        })).rejects.toThrow();
        expect(stageMutated).toBe(true);
      }
    }
  }, 30_000);

  it('restores an old target when the second rename cannot complete', async () => {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'old.txt'), 'old\n');
    await expect(prepareRelease(await options({ force: true }), {
      projectRoot: fixtureRoot,
      hooks: { beforeSecondRename: () => { throw new Error('second rename failed'); } }
    })).rejects.toThrow(/second rename failed/);
    await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old\n');
  });

  it('requires complete valid Java and CI evidence for a tagged release', async () => {
    await git(['tag', 'v0.1.1']);
    await expect(release(await taggedOptions({ javaMasterReport: undefined }))).rejects.toThrow(/both --java/);
    const badOptions = await taggedOptions();
    const malformed = JSON.parse(await readFile(badOptions.javaDevReport, 'utf8'));
    malformed.branch = 'master';
    await writeFile(badOptions.javaDevReport, JSON.stringify(malformed));
    await expect(release(badOptions)).rejects.toThrow(/Java dev report/);
    await expect(release(await taggedOptions({ ciRunUrl: 'http://github.com/mcartmel/nodel-webui-v2/actions/runs/1' }))).rejects.toThrow(/GitHub CI run URL/);
    await expect(release(await taggedOptions({ ciRunUrl: 'https://github.com/someone/else/actions/runs/1' }))).rejects.toThrow(/GitHub CI run URL/);
    await expect(resolveReleaseOptions(await taggedOptions({ source: join(fixtureRoot, 'other-dist') }), { projectRoot: fixtureRoot })).rejects.toThrow(/default project dist source/);
    await expect(resolveReleaseOptions(await options({ tag: 'v0.1.1', commit: (await git(['rev-parse', 'HEAD'])).stdout.trim(), branch: 'main', sourceDateEpoch: (await git(['show', '-s', '--format=%ct', 'HEAD'])).stdout.trim(), provided: new Set(['tag', 'commit', 'branch', 'source-date-epoch']) }), { projectRoot: fixtureRoot })).rejects.toThrow(/dist-inventory/);
  });

  it('standalone verification rejects corrupted release provenance, report, and inventory paths', async () => {
    await git(['tag', 'v0.1.1']);
    await release(await taggedOptions());
     await expect(verifyReleaseBundle(target)).resolves.toMatchObject({ schemaVersion: 5 });
    const releasePath = join(target, 'release.json');
    let manifest = JSON.parse(await readFile(releasePath, 'utf8'));
    manifest.componentContract.sha256 = '0'.repeat(64);
    await writeFile(releasePath, JSON.stringify(manifest));
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/descriptor must match its files inventory entry/);
    await release(await taggedOptions({ force: true }));
    manifest = JSON.parse(await readFile(releasePath, 'utf8'));
    manifest.name = '';
    await writeFile(releasePath, JSON.stringify(manifest));
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/name, version, or commit/);
    await release(await taggedOptions({ force: true }));
    manifest = JSON.parse(await readFile(releasePath, 'utf8'));
    manifest.deploymentManifest.sha256 = '0'.repeat(64);
    await writeFile(releasePath, JSON.stringify(manifest));
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/deployment manifest descriptor must match/);
    await release(await taggedOptions({ force: true }));
    manifest = JSON.parse(await readFile(releasePath, 'utf8'));
    manifest.files[0].path = '../escape';
    await writeFile(releasePath, JSON.stringify(manifest));
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/inventory is invalid/);
    await release(await taggedOptions({ force: true }));
    await writeFile(join(target, 'java-handoff', 'dev.json'), '{}');
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/hash or size does not match|unexpected keys/);
  });

  it('rejects packaged evidence tampering and descriptor substitution', async () => {
    await release();
    await writeFile(join(target, 'SBOM.cdx.json'), '{}\n');
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/hash or size does not match/);
    await release({ force: true });
    const manifestPath = join(target, 'release.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dependencyEvidence.licenses.sha256 = '0'.repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/dependency evidence descriptor/);
  });

  it('binds tagged releases to the checkpoint and rejects packaged deployment drift', async () => {
    await git(['tag', 'v0.1.1']);
    await release(await taggedOptions());
    const manifest = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
    expect(manifest.releaseProcess.distInventorySha256).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(join(target, 'v2', 'chunks', 'main.js'), 'changed\n');
    await expect(verifyReleaseBundle(target)).rejects.toThrow(/recorded dist inventory digest|hash or size/);
  });

  it('verifies ZIP file types and permits the workflow file-only ZIP shape when utilities are available', async () => {
    try {
      await execFileAsync('zip', ['-v']);
      await execFileAsync('zipinfo', ['-h']);
      await execFileAsync('unzip', ['-v']);
    } catch { return; }
    await release();
    const archive = join(fixtureRoot, 'build', 'release.zip');
    await execFileAsync('zip', ['-qr', archive, '.'], { cwd: target });
    await expect(verifyReleaseArchive(archive)).resolves.toMatchObject({ version: '0.1.1', publishable: false });

    const workflowArchive = join(fixtureRoot, 'build', 'workflow-shape.zip');
    await execFileAsync('bash', ['-c', 'find . -type f -print | LC_ALL=C sort | zip -X "$1" -@', '--', workflowArchive], { cwd: target });
    await expect(verifyReleaseArchive(workflowArchive)).resolves.toMatchObject({ version: '0.1.1', publishable: false });

    await symlink('components.html', join(target, 'linked-page'));
    const symlinkArchive = join(fixtureRoot, 'build', 'symlink.zip');
    await execFileAsync('zip', ['-yqr', symlinkArchive, '.'], { cwd: target });
    await expect(verifyReleaseArchive(symlinkArchive)).rejects.toThrow(/non-file, non-directory, or symlink/);
    await rm(join(target, 'linked-page'));

    await mkdir(join(target, 'empty-directory'));
    const directoryArchive = join(fixtureRoot, 'build', 'extra-directory.zip');
    await execFileAsync('zip', ['-qr', directoryArchive, '.'], { cwd: target });
    await expect(verifyReleaseArchive(directoryArchive)).rejects.toThrow(
      /unexpected directory entry|directories do not exactly match its inventory/
    );

    await release({ force: true });
    await rm(join(target, 'THIRD-PARTY-LICENSES.json'));
    const missingEvidenceArchive = join(fixtureRoot, 'build', 'missing-evidence.zip');
    await execFileAsync('zip', ['-qr', missingEvidenceArchive, '.'], { cwd: target });
    await expect(verifyReleaseArchive(missingEvidenceArchive)).rejects.toThrow(/archive entries do not exactly match|missing required dependency evidence|inventory/);
  });
});
