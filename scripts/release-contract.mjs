import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  assertProjectBuildTarget,
  createDeploymentInventory,
  isInside,
  loadDeploymentManifest,
  normalizeJavaHandoffReport,
  parseStrictArgs,
  readCapturedDeploymentEntry,
  safeRelativePath,
  sameTargetIdentity,
  targetState,
  validateCapturedDeploymentInventory,
  validateDeploymentReferences
} from './deployment-contract.mjs';
import { verifyDeploymentInventoryReport } from './verify-deployment-inventory.mjs';

const execFileAsync = promisify(execFile);
export const nodelApiRange = Object.freeze({ min: '1.0', maxExclusive: '2.0' });
export const releaseSchemaVersion = 3;
const deploymentManifestName = 'deployment-manifest.json';
const releaseFile = 'release.json';
const stableReleasePages = Object.freeze(['components.html', 'index.htm', 'nodel.html', 'nodes.html', 'toolkit.html']);
const handoffFiles = Object.freeze([
  ['LICENSE', 'LICENSE'],
  ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md'],
  ['RELEASE_NOTES.md', 'RELEASE_NOTES.md'],
  [deploymentManifestName, deploymentManifestName],
  ['docs/release-handoff.md', 'PRODUCTION_HANDOFF.md']
]);
const javaRoles = Object.freeze(['dev', 'master']);
const defaultOperations = Object.freeze({ lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile });

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sameKeys(value, keys) { return isRecord(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function isVersion(value) { return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value); }
function isCommit(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value); }
function validEpoch(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function validHash(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function safePath(value) { return safeRelativePath(value); }

async function git(projectRoot, args) {
  try {
    return (await execFileAsync('git', ['-C', projectRoot, ...args], { encoding: 'utf8' })).stdout.trim();
  } catch (error) {
    throw new Error(`Cannot determine release provenance from ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeGithubRepository(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) return null;
  const trimmed = value.trim().replace(/\.git\/?$/, '');
  const match = trimmed.match(/^(?:(?:github:|git\+https:\/\/github\.com\/|https:\/\/github\.com\/|git@github\.com:)?)([^/\s]+)\/([^/\s]+)$/i);
  return match ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}` : null;
}

function validCiRunUrl(value, repository) {
  return typeof value === 'string' && value === `https://github.com/${repository}/actions/runs/${value.split('/').pop()}`
    && /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/actions\/runs\/[1-9]\d*$/.test(value);
}

async function regularCapture(path, label, operations = defaultOperations) {
  const initial = await operations.lstat(path).catch(() => null);
  if (!initial?.isFile() || initial.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${path}`);
  const content = await operations.readFile(path);
  const final = await operations.lstat(path).catch(() => null);
  if (!final?.isFile() || final.isSymbolicLink() || initial.dev !== final.dev || initial.ino !== final.ino
    || initial.size !== final.size || content.length !== initial.size) throw new Error(`${label} changed while being captured: ${path}`);
  return Object.freeze({ path, bytes: content.length, sha256: sha256(content), content });
}

async function revalidateCapture(capture, label, operations = defaultOperations) {
  const current = await regularCapture(capture.path, label, operations);
  if (current.bytes !== capture.bytes || current.sha256 !== capture.sha256) throw new Error(`${label} changed after capture: ${capture.path}`);
  return current;
}

async function walkFiles(root, relativeRoot = '', operations = defaultOperations) {
  const entries = await operations.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (!safePath(relativePath)) throw new Error(`Unsafe filesystem entry in release bundle: ${path}`);
    const information = await operations.lstat(path);
    if (information.isSymbolicLink()) throw new Error(`Symlinks are not allowed in a release bundle: ${path}`);
    if (information.isDirectory()) files.push(...await walkFiles(path, relativePath, operations));
    else if (information.isFile()) files.push(relativePath);
    else throw new Error(`Unsupported filesystem entry in release bundle: ${path}`);
  }
  return files;
}

async function walkDirectories(root, relativeRoot = '', operations = defaultOperations) {
  const entries = await operations.readdir(root, { withFileTypes: true });
  const directories = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (!safePath(relativePath)) throw new Error(`Unsafe filesystem entry in release bundle: ${path}`);
    const information = await operations.lstat(path);
    if (information.isSymbolicLink()) throw new Error(`Symlinks are not allowed in a release bundle: ${path}`);
    if (information.isDirectory()) {
      directories.push(relativePath, ...await walkDirectories(path, relativePath, operations));
    } else if (!information.isFile()) throw new Error(`Unsupported filesystem entry in release bundle: ${path}`);
  }
  return directories.sort();
}

function requiredDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    parts.pop();
    while (parts.length) {
      directories.add(parts.join('/'));
      parts.pop();
    }
  }
  return [...directories].sort();
}

async function fileEntries(root, files, operations = defaultOperations) {
  const entries = [];
  for (const path of [...files].sort()) {
    const capture = await regularCapture(join(root, path), 'Release inventory entry', operations);
    entries.push({ path, bytes: capture.bytes, sha256: capture.sha256 });
  }
  return entries;
}

async function deploymentFilesInBundle(root, manifest, operations = defaultOperations) {
  const support = manifest.artifact.supportTree.slice(0, -3);
  const topLevel = await operations.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of topLevel) {
    if (manifest.artifact.stableEntries.includes(entry.name)) {
      const information = await operations.lstat(join(root, entry.name));
      if (!information.isFile() || information.isSymbolicLink()) throw new Error(`Invalid stable release page: ${entry.name}`);
      files.push(entry.name);
    }
  }
  if (files.sort().join('\0') !== manifest.artifact.stableEntries.join('\0')) throw new Error('Release bundle is missing a stable release page');
  const supportPath = join(root, support);
  const supportInfo = await operations.lstat(supportPath).catch(() => null);
  if (!supportInfo?.isDirectory() || supportInfo.isSymbolicLink()) throw new Error('Release bundle is missing its support tree');
  const all = await walkFiles(supportPath, support, operations);
  if (!all.includes(`${support}/nodel-webui.js`)) throw new Error('Release bundle is missing its stable loader chunk');
  return [...files, ...all].sort();
}

function validateInventoryEntries(entries, label) {
  if (!Array.isArray(entries)) throw new Error(`${label} inventory is invalid`);
  let previous = '';
  for (const entry of entries) {
    if (!sameKeys(entry, ['path', 'bytes', 'sha256']) || !safePath(entry.path) || entry.path <= previous
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !validHash(entry.sha256)) throw new Error(`${label} inventory is invalid`);
    previous = entry.path;
  }
}

async function readJavaReports(options, manifest, manifestHash, operations) {
  const paths = { dev: options.javaDevReport, master: options.javaMasterReport };
  if (Boolean(paths.dev) !== Boolean(paths.master)) throw new Error('Java evidence requires both --java-dev-report and --java-master-report');
  if (!paths.dev) return null;
  const reports = {};
  for (const role of javaRoles) {
    const capture = await regularCapture(resolve(paths[role]), `Java ${role} report`, operations);
    let parsed;
    try { parsed = JSON.parse(capture.content.toString('utf8')); } catch { throw new Error(`Java ${role} report is not valid JSON`); }
    const normalized = normalizeJavaHandoffReport(parsed, { role, manifest, manifestHash });
    const content = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`);
    reports[role] = Object.freeze({ source: capture, normalized, path: `java-handoff/${role}.json`, content, sha256: sha256(content) });
  }
  return Object.freeze(reports);
}

function javaEvidenceFor(reports) {
  if (!reports) return { available: false, targets: null };
  const targets = {};
  for (const role of javaRoles) {
    const report = reports[role];
    targets[role] = { role, branch: role, commit: report.normalized.commit, reportPath: report.path, reportSha256: report.sha256, v1InventorySha256: report.normalized.v1.inventorySha256 };
  }
  return { available: true, targets };
}

export function parseReleaseArgs(argv, { projectRoot = process.cwd() } = {}) {
  const provided = new Set(argv.filter((value) => value.startsWith('--')).map((value) => value.slice(2)));
  const options = parseStrictArgs(argv, {
    source: { default: () => resolve(projectRoot, 'dist') }, target: { default: () => resolve(projectRoot, 'build/release') },
    version: {}, commit: {}, branch: {}, tag: {}, repository: {}, 'source-date-epoch': { key: 'sourceDateEpoch' },
    'java-dev-report': { key: 'javaDevReport' }, 'java-master-report': { key: 'javaMasterReport' },
    'ci-run-url': { key: 'ciRunUrl' }, 'approval-environment': { key: 'approvalEnvironment' }, 'dist-inventory': { key: 'distInventory' },
    force: { type: 'boolean', default: false }, json: { type: 'boolean', default: false }, quiet: { type: 'boolean', default: false }
  });
  if (options.json && options.quiet) throw new Error('--json and --quiet cannot be used together');
  return { ...options, source: resolve(options.source), target: resolve(options.target), distInventory: options.distInventory && resolve(options.distInventory), provided };
}

async function gitState(root, gitRunner) {
  return Object.freeze({
    head: await gitRunner(root, ['rev-parse', 'HEAD']),
    branch: await gitRunner(root, ['branch', '--show-current']),
    status: await gitRunner(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  });
}

export async function resolveReleaseOptions(options, { projectRoot, gitRunner = git } = {}) {
  const root = resolve(projectRoot);
  const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const deploymentManifest = await loadDeploymentManifest(join(root, deploymentManifestName));
  const canonicalRepository = normalizeGithubRepository(deploymentManifest.manifest.artifact.repository);
  if (!isVersion(packageMetadata.version)) throw new Error('package.json version must be valid SemVer');
  const initial = await gitState(root, gitRunner);
  if (!isCommit(initial.head)) throw new Error(`Current git commit is not a full lowercase SHA-1: ${initial.head}`);
  if (!initial.branch && options.branch === undefined) throw new Error('Release source checkout must be on a branch, not detached HEAD');
  if (!initial.branch && !options.tag) throw new Error('Detached release source checkouts are only allowed for tagged main provenance');
  const version = options.version ?? packageMetadata.version;
  const commit = options.commit ?? initial.head;
  const branch = options.branch ?? initial.branch;
  const repository = options.repository ?? packageMetadata.repository;
  const packageRepository = normalizeGithubRepository(packageMetadata.repository);
  const normalizedRepository = normalizeGithubRepository(repository);
  if (!canonicalRepository || packageRepository !== canonicalRepository || normalizedRepository !== canonicalRepository) {
    throw new Error('Release repository must exactly match the canonical deployment manifest repository');
  }
  if (!isVersion(version) || version !== packageMetadata.version) throw new Error(`Release version ${version} does not match package.json version ${packageMetadata.version}`);
  if (!isCommit(commit) || commit !== initial.head) throw new Error(`Release commit must be the current full lowercase git commit: ${initial.head}`);
  if (typeof branch !== 'string' || !branch || (initial.branch && branch !== initial.branch)) throw new Error(`Release branch must match the current git branch: ${initial.branch}`);
  const tag = options.tag ?? null;
  if (tag !== null && tag !== `v${version}`) throw new Error(`Release tag must exactly match package version: v${version}`);
  const derivedEpoch = await gitRunner(root, ['show', '-s', '--format=%ct', commit]);
  const sourceDateEpoch = options.sourceDateEpoch === undefined ? Number(derivedEpoch) : Number(options.sourceDateEpoch);
  if (!validEpoch(sourceDateEpoch) || !/^(0|[1-9]\d*)$/.test(String(options.sourceDateEpoch ?? derivedEpoch))) throw new Error('source-date-epoch must be a non-negative deterministic integer');
  if (sourceDateEpoch !== Number(derivedEpoch)) throw new Error('source-date-epoch must equal the release commit timestamp');
  const dirty = initial.status.length > 0;
  if (tag !== null) {
    const defaultSource = resolve(root, 'dist');
    if (resolve(options.source) !== defaultSource) throw new Error('Tagged releases must use the default project dist source');
    if (!options.provided?.has('commit') || !options.provided?.has('branch') || !options.provided?.has('source-date-epoch')) throw new Error('Tagged releases require explicit --commit, --branch, and --source-date-epoch');
    if (!options.distInventory) throw new Error('Tagged releases require --dist-inventory');
    if (branch !== 'main') throw new Error('Tagged releases require branch main');
    if (dirty) throw new Error('Tagged releases require a clean tracked and untracked source checkout');
    const taggedCommit = await gitRunner(root, ['rev-parse', `${tag}^{commit}`]);
    if (taggedCommit !== commit) throw new Error(`Release tag ${tag} does not resolve to release commit ${commit}`);
    const origin = normalizeGithubRepository(await gitRunner(root, ['remote', 'get-url', 'origin']));
    if (origin !== canonicalRepository) throw new Error('Tagged release origin repository does not match canonical deployment manifest repository');
    await gitRunner(root, ['rev-parse', '--verify', 'refs/remotes/origin/main']);
    try { await gitRunner(root, ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']); }
    catch { throw new Error('Tagged release commit is not reachable from origin/main'); }
  }
  return Object.freeze({ ...options, projectRoot: root, packageMetadata, deploymentManifest, version, commit, branch, repository: canonicalRepository, tag, dirty,
    sourceDateEpoch, initial, publishable: false });
}

function expectedManifestKeys() { return ['schemaVersion', 'name', 'version', 'commit', 'source', 'sourceDateEpoch', 'nodelApi', 'deploymentManifest', 'releaseProcess', 'javaEvidence', 'inventoryAlgorithm', 'inventoryExcludes', 'files']; }

export function validateReleaseManifest(manifest, expected = undefined, deploymentManifest = undefined) {
  const canonicalRepository = deploymentManifest?.manifest?.artifact?.repository;
  if (!normalizeGithubRepository(canonicalRepository) || canonicalRepository !== normalizeGithubRepository(canonicalRepository)) {
    throw new Error('Release verification requires a canonical deployment manifest repository');
  }
  if (!sameKeys(manifest, expectedManifestKeys()) || manifest.schemaVersion !== releaseSchemaVersion) throw new Error(`release.json must contain exactly the schema ${releaseSchemaVersion} keys`);
  if (typeof manifest.name !== 'string' || !isVersion(manifest.version) || !isCommit(manifest.commit)) throw new Error('release.json name, version, or commit is invalid');
  if (!sameKeys(manifest.source, ['repository', 'branch', 'tag', 'dirty', 'publishable']) || !normalizeGithubRepository(manifest.source.repository)
    || manifest.source.repository !== canonicalRepository || typeof manifest.source.branch !== 'string' || !manifest.source.branch
    || !(manifest.source.tag === null || manifest.source.tag === `v${manifest.version}`)
    || typeof manifest.source.dirty !== 'boolean' || typeof manifest.source.publishable !== 'boolean') throw new Error('release.json source provenance is invalid');
  if (!validEpoch(manifest.sourceDateEpoch) || !sameKeys(manifest.nodelApi, ['min', 'maxExclusive'])
    || manifest.nodelApi.min !== nodelApiRange.min || manifest.nodelApi.maxExclusive !== nodelApiRange.maxExclusive) throw new Error('release.json sourceDateEpoch or nodelApi is invalid');
  if (!sameKeys(manifest.deploymentManifest, ['path', 'sha256', 'defaultV1Policy', 'javaTargets']) || manifest.deploymentManifest.path !== deploymentManifestName
    || !validHash(manifest.deploymentManifest.sha256) || manifest.deploymentManifest.defaultV1Policy !== 'preserve'
    || !sameKeys(manifest.deploymentManifest.javaTargets, ['dev', 'master']) || manifest.deploymentManifest.javaTargets.dev !== 'prerelease' || manifest.deploymentManifest.javaTargets.master !== 'stable') throw new Error('release.json deployment manifest contract is invalid');
  if (!sameKeys(manifest.releaseProcess, ['ciRunUrl', 'approvalEnvironment', 'distInventorySha256']) || !(manifest.releaseProcess.ciRunUrl === null || validCiRunUrl(manifest.releaseProcess.ciRunUrl, canonicalRepository))
    || !(manifest.releaseProcess.approvalEnvironment === null || typeof manifest.releaseProcess.approvalEnvironment === 'string')
    || !(manifest.releaseProcess.distInventorySha256 === null || validHash(manifest.releaseProcess.distInventorySha256))) throw new Error('release.json release process provenance is invalid');
  if (!sameKeys(manifest.javaEvidence, ['available', 'targets']) || typeof manifest.javaEvidence.available !== 'boolean') throw new Error('release.json Java evidence is invalid');
  if (!manifest.javaEvidence.available && manifest.javaEvidence.targets !== null) throw new Error('release.json unavailable Java evidence must not list targets');
  if (manifest.javaEvidence.available) {
    if (!sameKeys(manifest.javaEvidence.targets, javaRoles)) throw new Error('release.json Java evidence targets are invalid');
    for (const role of javaRoles) {
      const target = manifest.javaEvidence.targets[role];
      if (!sameKeys(target, ['role', 'branch', 'commit', 'reportPath', 'reportSha256', 'v1InventorySha256']) || target.role !== role || target.branch !== role
        || !isCommit(target.commit) || target.reportPath !== `java-handoff/${role}.json` || !validHash(target.reportSha256) || !validHash(target.v1InventorySha256)) throw new Error('release.json Java evidence target is invalid');
    }
  }
  const shouldPublish = manifest.source.repository === canonicalRepository && manifest.source.branch === 'main'
    && manifest.source.tag === `v${manifest.version}` && !manifest.source.dirty && manifest.javaEvidence.available
    && validCiRunUrl(manifest.releaseProcess.ciRunUrl, canonicalRepository) && manifest.releaseProcess.approvalEnvironment === 'production-release'
    && validHash(manifest.releaseProcess.distInventorySha256);
  if (manifest.source.publishable !== shouldPublish) throw new Error('release.json publishable status is not bound to complete provenance');
  if (manifest.inventoryAlgorithm !== 'sha256' || !Array.isArray(manifest.inventoryExcludes) || manifest.inventoryExcludes.length !== 1 || manifest.inventoryExcludes[0] !== releaseFile) throw new Error('release.json inventory policy is invalid');
  validateInventoryEntries(manifest.files, 'release.json');
  if (manifest.files.some((entry) => entry.path === releaseFile)) throw new Error('release.json cannot inventory itself');
  if (expected && (!sameKeys(expected, ['name', 'version', 'commit', 'repository', 'branch', 'tag', 'dirty', 'publishable', 'sourceDateEpoch', 'deploymentManifestHash', 'ciRunUrl', 'approvalEnvironment', 'distInventorySha256', 'javaEvidence', 'filesInventorySha256'])
    || !validHash(expected.filesInventorySha256)
    || manifest.name !== expected.name || manifest.version !== expected.version || manifest.commit !== expected.commit
    || manifest.source.repository !== expected.repository || manifest.source.branch !== expected.branch || manifest.source.tag !== expected.tag
    || manifest.source.dirty !== expected.dirty || manifest.source.publishable !== expected.publishable || manifest.sourceDateEpoch !== expected.sourceDateEpoch
    || manifest.deploymentManifest.sha256 !== expected.deploymentManifestHash
    || manifest.releaseProcess.ciRunUrl !== expected.ciRunUrl || manifest.releaseProcess.approvalEnvironment !== expected.approvalEnvironment
    || manifest.releaseProcess.distInventorySha256 !== expected.distInventorySha256
    || JSON.stringify(manifest.javaEvidence) !== JSON.stringify(expected.javaEvidence)
    || sha256(JSON.stringify(manifest.files)) !== expected.filesInventorySha256)) throw new Error('release.json does not match release provenance');
}

export async function verifyReleaseBundle(target, { operations = defaultOperations } = {}) {
  const root = resolve(target);
  const rootInfo = await operations.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`Release bundle must be a real directory: ${root}`);
  const deploymentCapture = await regularCapture(join(root, deploymentManifestName), 'Packaged deployment manifest', operations);
  const manifestData = await loadDeploymentManifest(join(root, deploymentManifestName), { fs: { readFile: operations.readFile } });
  const releaseCapture = await regularCapture(join(root, releaseFile), 'release.json', operations);
  let manifest;
  try { manifest = JSON.parse(releaseCapture.content.toString('utf8')); } catch { throw new Error('release.json is not valid JSON'); }
  validateReleaseManifest(manifest, undefined, manifestData);
  if (sha256(deploymentCapture.content) !== manifest.deploymentManifest.sha256) throw new Error('Packaged deployment manifest hash does not match release.json');
  const deploymentFiles = await deploymentFilesInBundle(root, manifestData.manifest, operations);
  const deploymentDigest = sha256(JSON.stringify(await fileEntries(root, deploymentFiles, operations)));
  if (manifest.releaseProcess.distInventorySha256 !== null && manifest.releaseProcess.distInventorySha256 !== deploymentDigest) {
    throw new Error('Packaged deployment files do not match the recorded dist inventory digest');
  }
  const allowed = new Set([...deploymentFiles, ...handoffFiles.map(([, destination]) => destination)]);
  if (manifest.javaEvidence.available) for (const role of javaRoles) allowed.add(manifest.javaEvidence.targets[role].reportPath);
  const outputFiles = await walkFiles(root, '', operations);
  const inventoryFiles = new Set(manifest.files.map((entry) => entry.path));
  if (outputFiles.length !== manifest.files.length + 1 || outputFiles.some((path) => path !== releaseFile && !inventoryFiles.has(path)) || manifest.files.some((entry) => !allowed.has(entry.path))) throw new Error('Release bundle contains unexpected or unlisted files');
  const expectedDirectories = requiredDirectories([...manifest.files.map((entry) => entry.path), releaseFile]);
  if ((await walkDirectories(root, '', operations)).join('\0') !== expectedDirectories.join('\0')) {
    throw new Error('Release bundle directories do not exactly match its inventory');
  }
  for (const entry of manifest.files) {
    const capture = await regularCapture(join(root, entry.path), 'Release inventory entry', operations);
    if (capture.bytes !== entry.bytes || capture.sha256 !== entry.sha256) throw new Error(`Release inventory hash or size does not match: ${entry.path}`);
  }
  for (const [, path] of handoffFiles) if (!inventoryFiles.has(path)) throw new Error(`Release bundle is missing required handoff file: ${path}`);
  if (manifest.javaEvidence.available) {
    for (const role of javaRoles) {
      const targetEvidence = manifest.javaEvidence.targets[role];
      const capture = await regularCapture(join(root, targetEvidence.reportPath), `Packaged Java ${role} report`, operations);
      if (capture.sha256 !== targetEvidence.reportSha256) throw new Error(`Packaged Java ${role} report hash does not match release.json`);
      let report;
      try { report = JSON.parse(capture.content.toString('utf8')); } catch { throw new Error(`Packaged Java ${role} report is not valid JSON`); }
      const normalized = normalizeJavaHandoffReport(report, { role, manifest: manifestData.manifest, manifestHash: manifestData.hash });
      if (normalized.commit !== targetEvidence.commit || normalized.v1.inventorySha256 !== targetEvidence.v1InventorySha256) throw new Error(`Packaged Java ${role} report does not match release.json`);
    }
  }
  await validateDeploymentReferences(root, deploymentFiles, { fs: { readFile: operations.readFile } });
  return manifest;
}

export async function validateReleaseBundle(target, expected, _deploymentFiles, { operations = defaultOperations } = {}) {
  const manifest = await verifyReleaseBundle(target, { operations });
  const deploymentManifest = await loadDeploymentManifest(join(resolve(target), deploymentManifestName), { fs: { readFile: operations.readFile } });
  validateReleaseManifest(manifest, expected, deploymentManifest);
  return manifest;
}

async function copyCapturedDeployment(inventory, stage, operations) {
  for (const entry of inventory.entries) {
    const content = await readCapturedDeploymentEntry(inventory.root, entry);
    const destination = join(stage, entry.path);
    await operations.mkdir(dirname(destination), { recursive: true });
    await operations.writeFile(destination, content);
  }
}

async function copyHandoffs(captures, stage, operations) {
  for (const capture of captures) {
    await revalidateCapture(capture, 'Release handoff file', operations);
    const destination = join(stage, capture.destination);
    await operations.mkdir(dirname(destination), { recursive: true });
    await operations.writeFile(destination, capture.content);
  }
}

async function captureStageIdentity(stage, operations) {
  const files = await walkFiles(stage, '', operations);
  const entries = await fileEntries(stage, files, operations);
  const release = await regularCapture(join(stage, releaseFile), 'release.json', operations);
  return Object.freeze({ files: Object.freeze(entries), releaseBytes: release.bytes, releaseSha256: release.sha256 });
}

async function revalidateFinalStage({ stage, expected, manifestData, inventory, handoffs, javaReports, resolved, gitRunner, operations, capturedIdentity }) {
  await validateCapturedDeploymentInventory(inventory);
  const currentSource = await createDeploymentInventory(resolved.source, manifestData.manifest);
  if (currentSource.inventorySha256 !== inventory.inventorySha256) throw new Error('Deployment source changed after release assembly');
  for (const capture of handoffs) await revalidateCapture(capture, 'Release handoff file', operations);
  if (javaReports) {
    const currentReports = await readJavaReports(resolved, manifestData.manifest, manifestData.hash, operations);
    for (const role of javaRoles) {
      await revalidateCapture(javaReports[role].source, `Java ${role} report`, operations);
      if (currentReports[role].source.sha256 !== javaReports[role].source.sha256) throw new Error(`Java ${role} report changed after capture`);
    }
  }
  if (resolved.distInventory) {
    const checked = await verifyDeploymentInventoryReport({ source: resolved.source, manifestData, manifestPath: manifestData.path, output: resolved.distInventory, projectRoot: resolved.projectRoot });
    if (checked.inventory.sha256 !== expected.distInventorySha256) throw new Error('Deployment inventory changed after release assembly');
  }
  await assertFinalTaggedProvenance(resolved, gitRunner);
  // Standalone verification detects internal contradictions; identity comparison detects a fully re-forged stage.
  // Keep all stage filesystem reads last so this is the final validation before a rename.
  await assertProjectBuildTarget(stage, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
  const manifest = await verifyReleaseBundle(stage, { operations });
  validateReleaseManifest(manifest, expected, manifestData);
  const currentIdentity = await captureStageIdentity(stage, operations);
  if (currentIdentity.releaseBytes !== capturedIdentity.releaseBytes || currentIdentity.releaseSha256 !== capturedIdentity.releaseSha256
    || JSON.stringify(currentIdentity.files) !== JSON.stringify(capturedIdentity.files)) {
    throw new Error('Release stage files or release.json changed after assembly');
  }
}

async function replaceTarget(target, stage, operations, hooks, verifyFinalStage, revalidateTarget, assertTargetAbsent, assertPaths) {
  const backup = join(dirname(target), `.${target.split(sep).pop()}.backup-${randomUUID()}`);
  const context = Object.freeze({ target, stage, backup });
  let movedTarget = false;
  try {
    await hooks.beforeFirstRename?.(context);
    const checkedTarget = await revalidateTarget();
    await assertPaths(backup);
    await verifyFinalStage();
    if (checkedTarget.exists) { await operations.rename(target, backup); movedTarget = true; }
    await hooks.beforeSecondRename?.(context);
    await assertTargetAbsent();
    await assertPaths(backup);
    await verifyFinalStage();
    await operations.rename(stage, target);
  } catch (error) {
    if (movedTarget) {
      try { await operations.rename(backup, target); } catch (restoreError) { throw new Error(`Release replacement failed and backup restoration failed: ${String(error)}; ${String(restoreError)}`); }
    }
    throw error;
  }
  if (movedTarget) await operations.rm(backup, { recursive: true, force: false }).catch(() => {});
}

async function assertFinalTaggedProvenance(resolved, gitRunner) {
  if (!resolved.tag) return;
  const final = await gitState(resolved.projectRoot, gitRunner);
  if (final.head !== resolved.commit || final.status.length > 0 || (final.branch && final.branch !== 'main')) {
    throw new Error('Tagged release source HEAD, branch, or status changed before cutover');
  }
  if ((await gitRunner(resolved.projectRoot, ['rev-parse', `${resolved.tag}^{commit}`])) !== resolved.commit) throw new Error('Tagged release tag changed before cutover');
  if (normalizeGithubRepository(await gitRunner(resolved.projectRoot, ['remote', 'get-url', 'origin'])) !== resolved.repository) {
    throw new Error('Tagged release origin repository changed before cutover');
  }
  await gitRunner(resolved.projectRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main']);
  try { await gitRunner(resolved.projectRoot, ['merge-base', '--is-ancestor', resolved.commit, 'refs/remotes/origin/main']); }
  catch { throw new Error('Tagged release commit is no longer reachable from origin/main before cutover'); }
}

export async function prepareRelease(options, { projectRoot, gitRunner = git, operations = defaultOperations, hooks = {} } = {}) {
  const resolved = await resolveReleaseOptions(options, { projectRoot, gitRunner });
  const manifestData = resolved.deploymentManifest;
  if (manifestData.manifest.artifact.name !== resolved.packageMetadata.name || manifestData.manifest.artifact.stableEntries.join('\0') !== stableReleasePages.join('\0')) throw new Error('deployment-manifest.json does not match the release package contract');
  const target = await assertProjectBuildTarget(resolved.target, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
  const inventory = await createDeploymentInventory(resolved.source, manifestData.manifest);
  const distInventory = resolved.distInventory
    ? await verifyDeploymentInventoryReport({ source: resolved.source, manifestData, manifestPath: manifestData.path, output: resolved.distInventory, projectRoot: resolved.projectRoot })
    : null;
  if (distInventory && distInventory.inventory.sha256 !== inventory.inventorySha256) throw new Error('Deployment inventory changed before release staging');
  const capturedTarget = await targetState(target, manifestData);
  if (!capturedTarget.empty && !resolved.force) throw new Error(`Refusing to replace non-empty release target without --force: ${target}`);
  const handoffs = [];
  for (const [source, destination] of handoffFiles) handoffs.push(Object.freeze({ ...await regularCapture(join(resolved.projectRoot, source), 'Release handoff file', operations), destination }));
  const javaReports = await readJavaReports(resolved, manifestData.manifest, manifestData.hash, operations);
  const javaEvidence = javaEvidenceFor(javaReports);
  const publishable = resolved.tag !== null && !resolved.dirty && javaEvidence.available
    && validCiRunUrl(resolved.ciRunUrl, resolved.repository) && resolved.approvalEnvironment === 'production-release';
  if (resolved.tag && !publishable) throw new Error('Tagged releases require Java evidence, a GitHub CI run URL, and approval environment production-release');
  const expected = Object.freeze({ name: resolved.packageMetadata.name, version: resolved.version, commit: resolved.commit, repository: resolved.repository,
    branch: resolved.branch, tag: resolved.tag, dirty: resolved.dirty, publishable, sourceDateEpoch: resolved.sourceDateEpoch, deploymentManifestHash: manifestData.hash,
    ciRunUrl: resolved.ciRunUrl ?? null, approvalEnvironment: resolved.approvalEnvironment ?? null,
    distInventorySha256: distInventory?.inventory.sha256 ?? null, javaEvidence });
  const stageParent = dirname(target);
  await operations.mkdir(stageParent, { recursive: true });
  const stage = await operations.mkdtemp(join(stageParent, `.${target.split(sep).pop()}.stage-`));
  try {
    await copyCapturedDeployment(inventory, stage, operations);
    await copyHandoffs(handoffs, stage, operations);
    if (javaReports) for (const role of javaRoles) {
      const report = javaReports[role];
      await revalidateCapture(report.source, `Java ${role} report`, operations);
      const output = join(stage, report.path);
      await operations.mkdir(dirname(output), { recursive: true });
      await operations.writeFile(output, report.content);
    }
    const bundleFiles = [...inventory.files, ...handoffs.map((capture) => capture.destination), ...(javaReports ? javaRoles.map((role) => javaReports[role].path) : [])].sort();
    if (distInventory) {
      const rechecked = await verifyDeploymentInventoryReport({ source: resolved.source, manifestData, manifestPath: manifestData.path, output: resolved.distInventory, projectRoot: resolved.projectRoot });
      if (rechecked.inventory.sha256 !== distInventory.inventory.sha256) throw new Error('Deployment inventory changed during release staging');
    }
    const releaseManifest = {
      schemaVersion: releaseSchemaVersion, name: expected.name, version: expected.version, commit: expected.commit,
      source: { repository: expected.repository, branch: expected.branch, tag: expected.tag, dirty: expected.dirty, publishable: expected.publishable },
      sourceDateEpoch: expected.sourceDateEpoch, nodelApi: nodelApiRange,
      deploymentManifest: { path: deploymentManifestName, sha256: manifestData.hash, defaultV1Policy: manifestData.manifest.v1.defaultPolicy, javaTargets: manifestData.manifest.java.targets },
      releaseProcess: { ciRunUrl: resolved.ciRunUrl ?? null, approvalEnvironment: resolved.approvalEnvironment ?? null, distInventorySha256: expected.distInventorySha256 }, javaEvidence,
      inventoryAlgorithm: 'sha256', inventoryExcludes: [releaseFile], files: await fileEntries(stage, bundleFiles, operations)
    };
    const finalExpected = Object.freeze({ ...expected, filesInventorySha256: sha256(JSON.stringify(releaseManifest.files)) });
    validateReleaseManifest(releaseManifest, finalExpected, manifestData);
    await operations.writeFile(join(stage, releaseFile), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8');
    await verifyReleaseBundle(stage, { operations });
    const capturedStage = await captureStageIdentity(stage, operations);
    const verifyFinalStage = () => revalidateFinalStage({
      stage, expected: finalExpected, manifestData, inventory, handoffs, javaReports, resolved, gitRunner, operations, capturedIdentity: capturedStage
    });
    await hooks.beforeCutover?.({ target, stage });
    const revalidateTarget = async () => {
      const freshTarget = await assertProjectBuildTarget(target, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
      const freshState = await targetState(target, manifestData);
      if (freshTarget !== target || !sameTargetIdentity(capturedTarget.identity, freshState.identity)
        || (!freshState.empty && !resolved.force)) throw new Error('Release target changed after ownership was checked');
      return freshState;
    };
    const assertTargetAbsent = async () => {
      const freshTarget = await assertProjectBuildTarget(target, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
      if (freshTarget !== target || (await targetState(target, manifestData)).exists) {
        throw new Error('Release target was created or substituted before the final rename');
      }
    };
    const assertPaths = async (backup) => {
      await assertProjectBuildTarget(target, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
      await assertProjectBuildTarget(stage, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
      await assertProjectBuildTarget(backup, { source: resolved.source, roots: { projectRoot: resolved.projectRoot } });
    };
    await replaceTarget(target, stage, operations, hooks, verifyFinalStage, revalidateTarget, assertTargetAbsent, assertPaths);
    return Object.freeze({ target, version: expected.version, commit: expected.commit, dirty: expected.dirty, publishable: expected.publishable, sourceDateEpoch: expected.sourceDateEpoch, fileCount: bundleFiles.length });
  } catch (error) {
    await operations.rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function formatReleaseReport(report) {
  return [`Prepared Nodel Web UI ${report.version} release at ${report.target}`, `Files: ${report.fileCount}; publishable: ${report.publishable}; dirty: ${report.dirty}`].join('\n');
}
