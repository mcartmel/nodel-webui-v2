import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectBuildTarget, loadDeploymentManifest, parseStrictArgs, projectRoot, verifyJavaHandoff } from './deployment-contract.mjs';

const scriptProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeOperations = { lstat, mkdir, rename, rm, writeFile, randomUUID };

export function parseVerifyJavaHandoffArgs(argv) {
  return parseStrictArgs(argv, {
    'java-checkout': { key: 'javaCheckout', required: true },
    'expected-branch': { key: 'expectedBranch' },
    manifest: { default: () => resolve(scriptProjectRoot, 'deployment-manifest.json') },
    output: {},
    json: { type: 'boolean', default: false }
  });
}

export async function runVerifyJavaHandoff(options, { operations = nativeOperations } = {}) {
  const manifestData = await loadDeploymentManifest(options.manifest);
  const report = await verifyJavaHandoff({
    javaCheckout: options.javaCheckout,
    expectedBranch: options.expectedBranch,
    manifest: manifestData.manifest,
    manifestHash: manifestData.hash
  });
  if (!options.output) return report;
  const output = await assertProjectBuildTarget(resolve(options.output), { roots: { projectRoot } });
  await operations.mkdir(dirname(output), { recursive: true });
  await assertProjectBuildTarget(output, { roots: { projectRoot } });
  const temporary = join(dirname(output), `.${output.split('/').pop()}.tmp-${(operations.randomUUID ?? randomUUID)()}`);
  let ownsTemporary = false;
  try {
    if (await operations.lstat(temporary).catch(() => null)) throw new Error(`Java handoff temporary output already exists: ${temporary}`);
    await assertProjectBuildTarget(temporary, { roots: { projectRoot } });
    await operations.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    ownsTemporary = true;
    await assertProjectBuildTarget(output, { roots: { projectRoot } });
    await assertProjectBuildTarget(temporary, { roots: { projectRoot } });
    const staged = await operations.lstat(temporary).catch(() => null);
    if (!staged?.isFile() || staged.isSymbolicLink()) throw new Error('Java handoff temporary output is not a regular file');
    await operations.rename(temporary, output);
  } finally {
    if (ownsTemporary) await operations.rm(temporary, { force: true }).catch(() => {});
  }
  return { ...report, output };
}

export function formatJavaHandoffReport(report) {
  return [
    `Java checkout: ${report.javaCheckout}`,
    `Git: ${report.repository} ${report.branch} ${report.commit}`,
    `V1 source: ${report.v1Source} (${report.v1FileCount} files; ${report.protectedV1FileCount} protected)`,
    `Approved collisions: ${report.collisions.join(', ') || 'none'}`,
    `Ignored generated changes: ${report.ignoredDirtyPaths.join(', ') || 'none'}`,
    `Canonical evidence digest: ${report.canonicalEvidenceSha256}`
  ].join('\n');
}

async function main() {
  const options = parseVerifyJavaHandoffArgs(process.argv.slice(2));
  const report = await runVerifyJavaHandoff(options);
  console.log(options.json ? JSON.stringify(report) : formatJavaHandoffReport(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
