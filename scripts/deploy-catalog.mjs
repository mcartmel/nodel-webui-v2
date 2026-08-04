import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProjectBuildTarget,
  createDeploymentInventory,
  isInside,
  loadDeploymentManifest,
  parseStrictArgs,
  projectBuildRoot,
  projectRoot,
  readCapturedDeploymentEntry,
  sha256,
  targetState
} from './deployment-contract.mjs';

const nativeOperations = { lstat, mkdir, readFile, rename, rm, writeFile, randomUUID };
const page = 'components.html';

export function parseDeployCatalogArgs(argv) {
  const options = parseStrictArgs(argv, {
    source: { default: () => resolve(projectRoot, 'dist') },
    target: { default: () => resolve(projectBuildRoot, 'deploy-catalog-preview') },
    'support-root': { key: 'supportRoot', required: true },
    manifest: { default: () => resolve(projectRoot, 'deployment-manifest.json') },
    'dry-run': { key: 'dryRun', type: 'boolean', default: false },
    json: { type: 'boolean', default: false }
  });
  return { ...options, source: resolve(options.source), target: resolve(options.target), supportRoot: resolve(options.supportRoot) };
}

async function pageIdentity(target, operations) {
  const directory = await operations.lstat(target).catch(() => null);
  if (!directory?.isDirectory() || directory.isSymbolicLink()) throw new Error(`Catalog target must be a real directory: ${target}`);
  const path = join(target, page);
  const information = await operations.lstat(path).catch(() => null);
  if (!information) return { targetDev: String(directory.dev), targetIno: String(directory.ino), absent: true };
  if (!information.isFile() || information.isSymbolicLink()) throw new Error(`Catalog page target must be a regular file: ${path}`);
  const content = await operations.readFile(path);
  return { targetDev: String(directory.dev), targetIno: String(directory.ino), dev: String(information.dev), ino: String(information.ino), sha256: sha256(content) };
}

export async function deployCatalog(options, { operations = nativeOperations, roots, hooks = {} } = {}) {
  const manifestData = await loadDeploymentManifest(options.manifest);
  const target = await assertProjectBuildTarget(options.target, { source: options.source, roots });
  const supportRoot = await assertProjectBuildTarget(options.supportRoot, { source: options.source, roots });
  if (isInside(target, supportRoot) || isInside(supportRoot, target)) {
    throw new Error('Catalog target and managed support root must not contain one another');
  }
  const inventory = await createDeploymentInventory(options.source, manifestData.manifest);
  const sourceEntry = inventory.entries.find((entry) => entry.path === page);
  const supportState = await targetState(supportRoot, manifestData);
  if (!supportState.managed) throw new Error(`Catalog support root must be a complete managed deployment: ${supportRoot}`);
  const supportPage = supportState.marker.files.find((entry) => entry.path === page);
  if (!supportPage || sourceEntry.bytes !== supportPage.bytes || sourceEntry.sha256 !== supportPage.sha256) {
    throw new Error('Catalog source page does not match the managed support deployment inventory');
  }
  const report = { source: join(inventory.root, page), target: join(target, page), supportRoot, page, dryRun: options.dryRun };
  if (options.dryRun) return report;
  await operations.mkdir(target, { recursive: true });
  await assertProjectBuildTarget(target, { source: options.source, roots });
  const targetIdentity = await pageIdentity(target, operations);
  const temporary = join(target, `.${page}.catalog-${(operations.randomUUID ?? randomUUID)()}`);
  let ownsTemporary = false;
  try {
    await operations.mkdir(dirname(temporary), { recursive: true });
    if (await operations.lstat(temporary).catch(() => null)) throw new Error(`Catalog temporary page already exists: ${temporary}`);
    await assertProjectBuildTarget(temporary, { source: options.source, roots });
    const capturedSource = await readCapturedDeploymentEntry(inventory.root, sourceEntry);
    await operations.writeFile(temporary, capturedSource, { flag: 'wx' });
    ownsTemporary = true;
    const verifyTemporary = async () => {
      const stagedInfo = await operations.lstat(temporary).catch(() => null);
      if (!stagedInfo?.isFile() || stagedInfo.isSymbolicLink()) throw new Error('Catalog staged page is not a regular file after hook');
      const staged = await operations.readFile(temporary);
      if (staged.length !== sourceEntry.bytes || sha256(staged) !== sourceEntry.sha256) {
        throw new Error('Catalog staged page changed after validation');
      }
    };
    await verifyTemporary();
    await hooks.beforeCutover?.({ target, supportRoot, temporary, sourceEntry, targetIdentity });
    await assertProjectBuildTarget(target, { source: options.source, roots });
    await assertProjectBuildTarget(supportRoot, { source: options.source, roots });
    await assertProjectBuildTarget(temporary, { source: options.source, roots });
    const currentSupport = await targetState(supportRoot, manifestData);
    if (!currentSupport.managed || sha256(JSON.stringify(currentSupport.marker)) !== sha256(JSON.stringify(supportState.marker))) {
      throw new Error('Catalog support root changed before cutover');
    }
    if (JSON.stringify(await pageIdentity(target, operations)) !== JSON.stringify(targetIdentity)) throw new Error('Catalog target was substituted or modified before cutover');
    await hooks.beforeRename?.({ target, supportRoot, temporary, sourceEntry, targetIdentity });
    await verifyTemporary();
    await operations.rename(temporary, report.target);
  } finally {
    if (ownsTemporary) {
      await assertProjectBuildTarget(temporary, { source: options.source, roots })
        .then(() => operations.rm(temporary, { force: true }))
        .catch(() => {});
    }
  }
  return report;
}

export function formatDeployCatalogReport(report) {
  return [
    `Catalog page: ${report.page}`,
    `Target: ${report.target}`,
    `Managed support root: ${report.supportRoot}`,
    'Catalog deployment changes only components.html; the node target need not contain v2.',
    report.dryRun ? 'Dry run: no files changed.' : 'Catalog deployment completed.'
  ].join('\n');
}

async function main() {
  const options = parseDeployCatalogArgs(process.argv.slice(2));
  const report = await deployCatalog(options);
  console.log(options.json ? JSON.stringify(report) : formatDeployCatalogReport(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
