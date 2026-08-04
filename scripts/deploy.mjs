import { copyFile, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProjectBuildTarget,
  createDeploymentInventory,
  deploymentMarker,
  filesMatch,
  loadDeploymentManifest,
  markerName,
  parseStrictArgs,
  projectBuildRoot,
  projectRoot,
  sameJavaHandoffEvidence,
  sameTargetIdentity,
  targetState,
  validateStagedDeployment,
  verifyJavaHandoff
} from './deployment-contract.mjs';

const nativeOperations = { copyFile, lstat, mkdir, rename, rm, writeFile };

function randomSuffix() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseDeployArgs(argv) {
  const options = parseStrictArgs(argv, {
    source: { default: () => resolve(projectRoot, 'dist') },
    target: { default: () => resolve(projectBuildRoot, 'deploy-preview') },
    'java-checkout': { key: 'javaCheckout' },
    'expected-java-branch': { key: 'expectedJavaBranch' },
    manifest: { default: () => resolve(projectRoot, 'deployment-manifest.json') },
    'dry-run': { key: 'dryRun', type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'allow-unmanaged-target': { key: 'allowUnmanagedTarget', type: 'boolean', default: false }
  });
  options.source = resolve(options.source);
  options.target = resolve(options.target);
  if (options.javaCheckout) {
    options.javaCheckout = resolve(options.javaCheckout);
    if (!options.expectedJavaBranch) throw new Error('--expected-java-branch is required with --java-checkout');
    if (!['dev', 'master'].includes(options.expectedJavaBranch)) throw new Error('--expected-java-branch must be dev or master');
  } else if (options.expectedJavaBranch) {
    throw new Error('--expected-java-branch requires --java-checkout');
  }
  return options;
}

async function copyInventory(inventory, stage, operations) {
  for (const entry of inventory.entries) {
    const destination = join(stage, entry.path);
    await operations.mkdir(dirname(destination), { recursive: true });
    await operations.copyFile(join(inventory.root, entry.path), destination, 0);
  }
}

async function replaceTarget(target, stage, backup, expectedIdentity, manifestData, operations, assertSafePath, verifyStage) {
  // A pair of renames is recoverable best effort, not a crash-proof atomic transaction.
  await assertSafePath(target);
  await assertSafePath(stage);
  await assertSafePath(backup);
  const current = await targetState(target, manifestData);
  if (!sameTargetIdentity(current.identity, expectedIdentity)) throw new Error('Deployment target changed after pre-cutover validation; refusing replacement');
  let movedTarget = false;
  try {
    if (current.exists) {
      await operations.rename(target, backup);
      movedTarget = true;
    }
    await assertSafePath(target);
    await assertSafePath(stage);
    await assertSafePath(backup);
    if ((await targetState(target, manifestData)).exists) throw new Error('Deployment target was recreated before the final rename');
    await verifyStage();
    await operations.rename(stage, target);
  } catch (error) {
    if (movedTarget) {
      try {
        await operations.rename(backup, target);
      } catch (restoreError) {
        throw new Error(`Deployment replacement failed; backup remains at ${backup} and restoration failed: ${error instanceof Error ? error.message : String(error)}; ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
      throw new Error(`Deployment replacement failed; the previous target was restored: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  if (!movedTarget) return null;
  try {
    await assertSafePath(backup);
    await operations.rm(backup, { recursive: true, force: false });
    return null;
  } catch (error) {
    return `Deployment completed but backup was retained at ${backup}; remove it only after verifying the target: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function deploy(options, { operations = nativeOperations, roots, hooks = {} } = {}) {
  if (options.javaCheckout && !['dev', 'master'].includes(options.expectedJavaBranch)) {
    throw new Error('An isolated Java deployment requires expectedJavaBranch dev or master');
  }
  const manifestData = await loadDeploymentManifest(options.manifest);
  const target = await assertProjectBuildTarget(options.target, { source: options.source, javaCheckout: options.javaCheckout, roots });
  const inventory = await createDeploymentInventory(options.source, manifestData.manifest);
  const state = await targetState(target, manifestData);
  if (!state.empty && !state.managed && !options.allowUnmanagedTarget) {
    throw new Error(`Refusing non-empty unmanaged deployment target: ${target}; use --allow-unmanaged-target only for explicit first use`);
  }
  const handoff = options.javaCheckout
    ? await verifyJavaHandoff({ javaCheckout: options.javaCheckout, expectedBranch: options.expectedJavaBranch, manifest: manifestData.manifest, manifestHash: manifestData.hash })
    : null;
  const report = {
    mode: handoff ? 'isolated-test' : 'project-preview',
    source: inventory.root,
    target,
    dryRun: options.dryRun,
    inventory: { pages: inventory.pageFiles, supportFiles: inventory.supportFiles, files: inventory.entries, sha256: inventory.inventorySha256 },
    targetState: state.managed ? 'managed' : state.empty ? 'empty' : 'unmanaged-first-use',
    collisions: handoff?.collisions ?? [],
    java: handoff ? {
      checkout: handoff.javaCheckout,
      repository: handoff.repository,
      branch: handoff.branch,
      commit: handoff.commit,
      remote: handoff.repositoryRemote,
      evidenceSha256: handoff.canonicalEvidenceSha256
    } : null,
    recovery: null
  };
  if (options.dryRun) return report;
  if (handoff) console.error(`WARNING: destructive isolated test deployment will replace ${target}; production Java merge remains V1-preserving.`);
  const stage = join(dirname(target), `.${basename(target)}.stage-${randomSuffix()}`);
  const backup = join(dirname(target), `.${basename(target)}.backup-${randomSuffix()}`);
  try {
    await operations.mkdir(dirname(target), { recursive: true });
    // mkdir can race with a substituted ancestor; validate again before making any child.
    await assertProjectBuildTarget(target, { source: options.source, javaCheckout: options.javaCheckout, roots });
    await operations.mkdir(stage);
    await copyInventory(inventory, stage, operations);
    if (!await filesMatch(inventory.root, stage, inventory.entries)) throw new Error('Staged deployment files or source changed after inventory capture');
    await operations.writeFile(join(stage, markerName), `${JSON.stringify(deploymentMarker(manifestData, inventory), null, 2)}\n`, 'utf8');
    const verifyStage = async () => {
      await validateStagedDeployment(stage, manifestData, inventory);
      if (!await filesMatch(inventory.root, stage, inventory.entries)) throw new Error('Staged deployment files or source changed after inventory capture');
    };
    await verifyStage();
    await hooks.beforeCutover?.({ target, stage, backup, inventory, initialState: state });
    await assertProjectBuildTarget(target, { source: options.source, javaCheckout: options.javaCheckout, roots });
    await assertProjectBuildTarget(stage, { source: options.source, javaCheckout: options.javaCheckout, roots });
    await assertProjectBuildTarget(backup, { source: options.source, javaCheckout: options.javaCheckout, roots });
    await verifyStage();
    const beforeCutover = await targetState(target, manifestData);
    if (!sameTargetIdentity(beforeCutover.identity, state.identity)) throw new Error('Deployment target was created, substituted, or modified before cutover');
    if (handoff) {
      const finalHandoff = await verifyJavaHandoff({
        javaCheckout: options.javaCheckout,
        expectedBranch: options.expectedJavaBranch,
        manifest: manifestData.manifest,
        manifestHash: manifestData.hash
      });
      if (!sameJavaHandoffEvidence(handoff, finalHandoff)) {
        throw new Error('Java handoff evidence changed before cutover');
      }
    }
    const assertSafePath = (path) => assertProjectBuildTarget(path, { source: options.source, javaCheckout: options.javaCheckout, roots });
    report.recovery = await replaceTarget(target, stage, backup, state.identity, manifestData, operations, assertSafePath, verifyStage);
  } catch (error) {
    await assertProjectBuildTarget(stage, { source: options.source, javaCheckout: options.javaCheckout, roots })
      .then(() => operations.rm(stage, { recursive: true, force: true }))
      .catch(() => {});
    throw error;
  }
  return report;
}

export function formatDeployReport(report) {
  return [
    `Deployment mode: ${report.mode}`,
    `Target: ${report.target}`,
    `Inventory: ${report.inventory.pages.length} pages, ${report.inventory.supportFiles.length} support files`,
    `Target state: ${report.targetState}`,
    `V1 collisions: ${report.collisions.join(', ') || 'not checked (project preview)'}`,
    report.recovery ?? 'Deployment completed. Process interruption between renames requires manual backup recovery.',
    report.dryRun ? 'Dry run: no files changed.' : ''
  ].filter(Boolean).join('\n');
}

async function main() {
  const options = parseDeployArgs(process.argv.slice(2));
  const report = await deploy(options);
  console.log(options.json ? JSON.stringify(report) : formatDeployReport(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
