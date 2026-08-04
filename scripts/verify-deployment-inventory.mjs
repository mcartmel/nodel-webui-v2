import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoSymlinkAncestors,
  createDeploymentInventory,
  isInside,
  loadDeploymentManifest,
  parseStrictArgs,
  safeRelativePath
} from './deployment-contract.mjs';

const scriptProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const deploymentInventorySchemaVersion = 1;

function canonicalText(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function canonicalManifestPath(manifestPath, projectRoot) {
  const path = relative(projectRoot, resolve(manifestPath)).split(sep).join('/');
  if (!safeRelativePath(path)) throw new Error('Deployment inventory manifest must be a canonical project-relative path');
  return path;
}

async function assertReportPath(path, { projectRoot, source }) {
  const root = resolve(projectRoot);
  const buildRoot = resolve(root, 'build');
  const output = resolve(path);
  if (!isInside(buildRoot, output) || output === buildRoot || !safeRelativePath(relative(buildRoot, output).split(sep).join('/'))) {
    throw new Error(`Deployment inventory report must be a file below the project build directory: ${output}`);
  }
  if (source && (isInside(output, source) || isInside(source, output))) {
    throw new Error(`Deployment inventory report must not contain or be contained by the source: ${output}`);
  }
  await assertNoSymlinkAncestors(root);
  await assertNoSymlinkAncestors(buildRoot);
  await assertNoSymlinkAncestors(dirname(output));
  const existing = await lstat(output).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Deployment inventory report must be a regular file: ${output}`);
  return output;
}

export async function createDeploymentInventoryReport({ source, manifestData, manifestPath, projectRoot }) {
  const inventory = await createDeploymentInventory(source, manifestData.manifest);
  return Object.freeze({
    schemaVersion: deploymentInventorySchemaVersion,
    deploymentManifest: { path: canonicalManifestPath(manifestPath, projectRoot), sha256: manifestData.hash },
    inventory: { algorithm: 'sha256', entries: inventory.entries, sha256: inventory.inventorySha256 }
  });
}

export async function verifyDeploymentInventoryReport({ source, manifestData, manifestPath, output, projectRoot }) {
  const reportPath = await assertReportPath(output, { projectRoot, source });
  const initial = await lstat(reportPath).catch(() => null);
  if (!initial?.isFile() || initial.isSymbolicLink()) throw new Error(`Deployment inventory report must be a regular file: ${reportPath}`);
  const text = await readFile(reportPath, 'utf8');
  const final = await lstat(reportPath).catch(() => null);
  if (!final?.isFile() || final.isSymbolicLink() || initial.dev !== final.dev || initial.ino !== final.ino || initial.size !== final.size || Buffer.byteLength(text) !== initial.size) {
    throw new Error(`Deployment inventory report changed while being read: ${reportPath}`);
  }
  let report;
  try { report = JSON.parse(text); } catch { throw new Error(`Deployment inventory report is not valid JSON: ${reportPath}`); }
  const expected = await createDeploymentInventoryReport({ source, manifestData, manifestPath, projectRoot });
  if (text !== canonicalText(expected) || JSON.stringify(report) !== JSON.stringify(expected)) {
    throw new Error('Deployment inventory report does not exactly match the current canonical deployment inventory');
  }
  return expected;
}

export function parseVerifyDeploymentInventoryArgs(argv, { projectRoot = scriptProjectRoot } = {}) {
  const options = parseStrictArgs(argv, {
    source: { default: () => resolve(projectRoot, 'dist') },
    manifest: { default: () => resolve(projectRoot, 'deployment-manifest.json') },
    output: { default: () => resolve(projectRoot, 'build/dist-inventory.json') },
    write: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }
  });
  if (options.write === options.check) throw new Error('Specify exactly one of --write or --check');
  return { ...options, source: resolve(options.source), manifest: resolve(options.manifest), output: resolve(options.output) };
}

export async function runVerifyDeploymentInventory(options, { projectRoot = scriptProjectRoot } = {}) {
  const manifestData = await loadDeploymentManifest(options.manifest);
  if (options.check) return verifyDeploymentInventoryReport({ ...options, manifestPath: options.manifest, manifestData, projectRoot });
  const output = await assertReportPath(options.output, { projectRoot, source: options.source });
  await mkdir(dirname(output), { recursive: true });
  await assertReportPath(output, { projectRoot, source: options.source });
  const report = await createDeploymentInventoryReport({ ...options, manifestPath: options.manifest, manifestData, projectRoot });
  const temporary = resolve(dirname(output), `.${basename(output)}.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, canonicalText(report), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await assertReportPath(output, { projectRoot, source: options.source });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return report;
}

function formatReport(report) {
  return `Deployment inventory: ${report.inventory.entries.length} files; digest ${report.inventory.sha256}`;
}

async function main() {
  const options = parseVerifyDeploymentInventoryArgs(process.argv.slice(2));
  const report = await runVerifyDeploymentInventory(options);
  console.log(options.json ? JSON.stringify(report) : formatReport(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
