import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parser as commonMarkParser } from '@lezer/markdown';
import {
  assertProjectBuildTarget,
  componentContractPath,
  componentContractSchemaVersion,
  createDeploymentInventory,
  loadDeploymentManifest,
  normalizeJavaHandoffReport,
  parseStrictArgs,
  readCapturedDeploymentEntry,
  safeRelativePath,
  sameTargetIdentity,
  targetState,
  validateComponentContractArtifact,
  validateCapturedDeploymentInventory,
  validateDeploymentReferences
} from './deployment-contract.mjs';
import { verifyDeploymentInventoryReport } from './verify-deployment-inventory.mjs';
import { generateDependencyEvidence, validateDependencyEvidence } from './dependency-evidence.mjs';

const execFileAsync = promisify(execFile);
export const nodelApiRange = Object.freeze({ min: '1.0', maxExclusive: '2.0' });
export const releaseSchemaVersion = 5;
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
const dependencyEvidenceFiles = Object.freeze(['SBOM.cdx.json', 'THIRD-PARTY-LICENSES.json']);
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

export function validateTaggedReleaseNotes(markdown, version) {
  if (typeof markdown !== 'string' || !isVersion(version)) throw new Error('Tagged release notes validation requires Markdown and a valid package version');
  const headings = [];
  commonMarkParser.parse(markdown).iterate({ enter(node) {
    if (node.name !== 'ATXHeading2' || node.node.parent?.name !== 'Document') return;
    headings.push(markdown.slice(node.from, node.to)
      .replace(/^ {0,3}##[ \t]+/u, '')
      .replace(/[ \t]+#+[ \t]*$/u, '')
      .trim());
  }});
  if (!headings.includes(version)) {
    const available = headings.length ? ` Found level-2 headings: ${headings.map((heading) => `## ${heading}`).join(', ')}.` : ' No level-2 headings were found.';
    throw new Error(`Tagged release notes must contain the exact ## ${version} heading; convert ## Unreleased to ## ${version} before tagged release preparation.${available}`);
  }
  return true;
}

async function git(projectRoot, args) {
  try {
    return (await execFileAsync('git', ['-C', projectRoot, ...args], { encoding: 'utf8' })).stdout.trim();
  } catch (error) {
    throw new Error(`Cannot determine release provenance from ${projectRoot}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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

async function readDependencyEvidence(root, operations = defaultOperations) {
  const evidenceRoot = join(root, 'build/dependency-evidence');
  const captures = {};
  for (const path of dependencyEvidenceFiles) captures[path] = await regularCapture(join(evidenceRoot, path), 'Dependency evidence', operations);
  let sbom; let licenses;
  try { sbom = JSON.parse(captures['SBOM.cdx.json'].content); licenses = JSON.parse(captures['THIRD-PARTY-LICENSES.json'].content); } catch { throw new Error('Dependency evidence files must be valid JSON'); }
  const lock = await regularCapture(join(root, 'package-lock.json'), 'package-lock.json', operations);
  const policy = await regularCapture(join(root, 'security/license-policy.json'), 'license-policy.json', operations);
  const notices = await regularCapture(join(root, 'THIRD-PARTY-NOTICES.md'), 'THIRD-PARTY-NOTICES.md', operations);
  const descriptor = { lockSha256: sha256(lock.content), policySha256: sha256(policy.content), noticeSha256: sha256(notices.content), sbom: { path: 'SBOM.cdx.json', sha256: captures['SBOM.cdx.json'].sha256 }, licenses: { path: 'THIRD-PARTY-LICENSES.json', sha256: captures['THIRD-PARTY-LICENSES.json'].sha256 } };
  validateDependencyEvidence({ sbom, licenses, lockHash: descriptor.lockSha256, policyHash: descriptor.policySha256, noticeHash: descriptor.noticeSha256 });
  if (licenses.noticeHash !== descriptor.noticeSha256 || licenses.policyHash !== descriptor.policySha256) throw new Error('Dependency evidence is not bound to the current policy and notices');
  const generated = await generateDependencyEvidence({ projectRoot: root });
  if (generated.files.sbom !== captures['SBOM.cdx.json'].content.toString('utf8') || generated.files.licenses !== captures['THIRD-PARTY-LICENSES.json'].content.toString('utf8')) throw new Error('Dependency evidence is stale or was substituted; regenerate build/dependency-evidence');
  return Object.freeze({ captures, sourceCaptures: { lock, policy, notices }, descriptor });
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
  if (tag !== null) validateTaggedReleaseNotes(await readFile(join(root, 'RELEASE_NOTES.md'), 'utf8'), version);
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

function expectedManifestKeys() { return ['schemaVersion', 'name', 'version', 'commit', 'source', 'sourceDateEpoch', 'nodelApi', 'deploymentManifest', 'componentContract', 'dependencyEvidence', 'releaseProcess', 'javaEvidence', 'inventoryAlgorithm', 'inventoryExcludes', 'files']; }

export function validateReleaseManifest(manifest, expected = undefined, deploymentManifest = undefined) {
  const canonicalRepository = deploymentManifest?.manifest?.artifact?.repository;
  if (!normalizeGithubRepository(canonicalRepository) || canonicalRepository !== normalizeGithubRepository(canonicalRepository)) {
    throw new Error('Release verification requires a canonical deployment manifest repository');
  }
  if (!sameKeys(manifest, expectedManifestKeys()) || manifest.schemaVersion !== releaseSchemaVersion) throw new Error(`release.json must contain exactly the schema ${releaseSchemaVersion} keys`);
  if (manifest.name !== deploymentManifest.manifest.artifact.name || !isVersion(manifest.version) || !isCommit(manifest.commit)) throw new Error('release.json name, version, or commit is invalid');
  if (!sameKeys(manifest.source, ['repository', 'branch', 'tag', 'dirty', 'publishable']) || !normalizeGithubRepository(manifest.source.repository)
    || manifest.source.repository !== canonicalRepository || typeof manifest.source.branch !== 'string' || !manifest.source.branch
    || !(manifest.source.tag === null || manifest.source.tag === `v${manifest.version}`)
    || typeof manifest.source.dirty !== 'boolean' || typeof manifest.source.publishable !== 'boolean') throw new Error('release.json source provenance is invalid');
  if (!validEpoch(manifest.sourceDateEpoch) || !sameKeys(manifest.nodelApi, ['min', 'maxExclusive'])
    || manifest.nodelApi.min !== nodelApiRange.min || manifest.nodelApi.maxExclusive !== nodelApiRange.maxExclusive) throw new Error('release.json sourceDateEpoch or nodelApi is invalid');
  if (!sameKeys(manifest.deploymentManifest, ['path', 'sha256', 'defaultV1Policy', 'javaTargets']) || manifest.deploymentManifest.path !== deploymentManifestName
    || !validHash(manifest.deploymentManifest.sha256) || manifest.deploymentManifest.defaultV1Policy !== 'preserve'
     || !sameKeys(manifest.deploymentManifest.javaTargets, ['dev', 'master']) || manifest.deploymentManifest.javaTargets.dev !== 'prerelease' || manifest.deploymentManifest.javaTargets.master !== 'stable') throw new Error('release.json deployment manifest contract is invalid');
   if (!sameKeys(manifest.componentContract, ['path', 'schemaVersion', 'sha256']) || manifest.componentContract.path !== componentContractPath
    || manifest.componentContract.schemaVersion !== componentContractSchemaVersion || !validHash(manifest.componentContract.sha256)) {
    throw new Error('release.json component contract is invalid');
  }
  if (!sameKeys(manifest.dependencyEvidence, ['lockSha256', 'policySha256', 'noticeSha256', 'sbom', 'licenses']) || !validHash(manifest.dependencyEvidence.lockSha256) || !validHash(manifest.dependencyEvidence.policySha256) || !validHash(manifest.dependencyEvidence.noticeSha256)
    || !sameKeys(manifest.dependencyEvidence.sbom, ['path', 'sha256']) || manifest.dependencyEvidence.sbom.path !== 'SBOM.cdx.json' || !validHash(manifest.dependencyEvidence.sbom.sha256)
    || !sameKeys(manifest.dependencyEvidence.licenses, ['path', 'sha256']) || manifest.dependencyEvidence.licenses.path !== 'THIRD-PARTY-LICENSES.json' || !validHash(manifest.dependencyEvidence.licenses.sha256)) throw new Error('release.json dependency evidence is invalid');
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
  const componentContractEntry = manifest.files.find((entry) => entry.path === componentContractPath);
  if (!componentContractEntry || componentContractEntry.sha256 !== manifest.componentContract.sha256) {
    throw new Error('release.json component contract descriptor must match its files inventory entry');
  }
  const deploymentManifestEntry = manifest.files.find((entry) => entry.path === deploymentManifestName);
  if (!deploymentManifestEntry || deploymentManifestEntry.sha256 !== manifest.deploymentManifest.sha256) {
    throw new Error('release.json deployment manifest descriptor must match its files inventory entry');
  }
  for (const descriptor of [manifest.dependencyEvidence.sbom, manifest.dependencyEvidence.licenses]) {
    const entry = manifest.files.find(item => item.path === descriptor.path);
    if (!entry || entry.sha256 !== descriptor.sha256) throw new Error('release.json dependency evidence descriptor must match its files inventory entry');
  }
  if (expected && (!sameKeys(expected, ['name', 'version', 'commit', 'repository', 'branch', 'tag', 'dirty', 'publishable', 'sourceDateEpoch', 'deploymentManifestHash', 'componentContract', 'dependencyEvidence', 'ciRunUrl', 'approvalEnvironment', 'distInventorySha256', 'javaEvidence', 'filesInventorySha256'])
    || !validHash(expected.filesInventorySha256)
    || manifest.name !== expected.name || manifest.version !== expected.version || manifest.commit !== expected.commit
    || manifest.source.repository !== expected.repository || manifest.source.branch !== expected.branch || manifest.source.tag !== expected.tag
    || manifest.source.dirty !== expected.dirty || manifest.source.publishable !== expected.publishable || manifest.sourceDateEpoch !== expected.sourceDateEpoch
    || manifest.deploymentManifest.sha256 !== expected.deploymentManifestHash
    || JSON.stringify(manifest.componentContract) !== JSON.stringify(expected.componentContract)
    || manifest.releaseProcess.ciRunUrl !== expected.ciRunUrl || manifest.releaseProcess.approvalEnvironment !== expected.approvalEnvironment
    || manifest.releaseProcess.distInventorySha256 !== expected.distInventorySha256
    || JSON.stringify(manifest.javaEvidence) !== JSON.stringify(expected.javaEvidence)
    || JSON.stringify(manifest.dependencyEvidence) !== JSON.stringify(expected.dependencyEvidence)
    || sha256(JSON.stringify(manifest.files)) !== expected.filesInventorySha256)) throw new Error('release.json does not match release provenance');
}

export async function verifyReleaseBundle(target, { operations = defaultOperations } = {}) {
  const root = resolve(target);
  const rootInfo = await operations.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`Release bundle must be a real directory: ${root}`);
  const deploymentCapture = await regularCapture(join(root, deploymentManifestName), 'Packaged deployment manifest', operations);
  const manifestData = await loadDeploymentManifest(join(root, deploymentManifestName), { fs: { readFile: () => Promise.resolve(deploymentCapture.content.toString('utf8')) } });
  const releaseCapture = await regularCapture(join(root, releaseFile), 'release.json', operations);
  let manifest;
  try { manifest = JSON.parse(releaseCapture.content.toString('utf8')); } catch { throw new Error('release.json is not valid JSON'); }
  validateReleaseManifest(manifest, undefined, manifestData);
  if (sha256(deploymentCapture.content) !== manifest.deploymentManifest.sha256) throw new Error('Packaged deployment manifest hash does not match release.json');
  const deploymentFiles = await deploymentFilesInBundle(root, manifestData.manifest, operations);
  const allowed = new Set([...deploymentFiles, ...handoffFiles.map(([, destination]) => destination), ...dependencyEvidenceFiles]);
  if (manifest.javaEvidence.available) for (const role of javaRoles) allowed.add(manifest.javaEvidence.targets[role].reportPath);
  const outputFiles = await walkFiles(root, '', operations);
  const inventoryFiles = new Set(manifest.files.map((entry) => entry.path));
  if (outputFiles.length !== manifest.files.length + 1 || outputFiles.some((path) => path !== releaseFile && !inventoryFiles.has(path)) || manifest.files.some((entry) => !allowed.has(entry.path))) throw new Error('Release bundle contains unexpected or unlisted files');
  const expectedDirectories = requiredDirectories([...manifest.files.map((entry) => entry.path), releaseFile]);
  if ((await walkDirectories(root, '', operations)).join('\0') !== expectedDirectories.join('\0')) {
    throw new Error('Release bundle directories do not exactly match its inventory');
  }
  const capturedFiles = new Map();
  for (const entry of manifest.files) {
    const capture = await regularCapture(join(root, entry.path), 'Release inventory entry', operations);
    if (capture.bytes !== entry.bytes || capture.sha256 !== entry.sha256) throw new Error(`Release inventory hash or size does not match: ${entry.path}`);
    capturedFiles.set(entry.path, capture.content);
  }
  const componentContractContent = capturedFiles.get(componentContractPath);
  if (!componentContractContent) throw new Error('Release inventory is missing the packaged component contract');
  validateComponentContractArtifact(componentContractContent, manifest.version);
  if (sha256(componentContractContent) !== manifest.componentContract.sha256) throw new Error('Packaged component contract hash does not match release.json');
  const sbomContent = capturedFiles.get('SBOM.cdx.json'); const licensesContent = capturedFiles.get('THIRD-PARTY-LICENSES.json');
  if (!sbomContent || !licensesContent) throw new Error('Release inventory is missing dependency evidence');
  let sbom; let licenses; try { sbom = JSON.parse(sbomContent); licenses = JSON.parse(licensesContent); } catch { throw new Error('Dependency evidence is not valid JSON'); }
  validateDependencyEvidence({ sbom, licenses, lockHash: manifest.dependencyEvidence.lockSha256, policyHash: manifest.dependencyEvidence.policySha256, noticeHash: manifest.dependencyEvidence.noticeSha256 });
  if (sha256(sbomContent) !== manifest.dependencyEvidence.sbom.sha256 || sha256(licensesContent) !== manifest.dependencyEvidence.licenses.sha256) throw new Error('Packaged dependency evidence hash does not match release.json');
  const noticesEntry = manifest.files.find(entry => entry.path === 'THIRD-PARTY-NOTICES.md');
  if (!noticesEntry || noticesEntry.sha256 !== manifest.dependencyEvidence.noticeSha256) throw new Error('Packaged notices do not match dependency evidence');
  const inventoryByPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const deploymentEntries = deploymentFiles.map((path) => inventoryByPath.get(path));
  if (deploymentEntries.some((entry) => !entry)) throw new Error('Release inventory is missing a packaged deployment file');
  const deploymentDigest = sha256(JSON.stringify(deploymentEntries));
  if (manifest.releaseProcess.distInventorySha256 !== null && manifest.releaseProcess.distInventorySha256 !== deploymentDigest) {
    throw new Error('Packaged deployment files do not match the recorded dist inventory digest');
  }
  for (const [, path] of handoffFiles) if (!inventoryFiles.has(path)) throw new Error(`Release bundle is missing required handoff file: ${path}`);
  for (const path of dependencyEvidenceFiles) if (!inventoryFiles.has(path)) throw new Error(`Release bundle is missing required dependency evidence: ${path}`);
  if (manifest.javaEvidence.available) {
    for (const role of javaRoles) {
      const targetEvidence = manifest.javaEvidence.targets[role];
      const content = capturedFiles.get(targetEvidence.reportPath);
      if (!content || sha256(content) !== targetEvidence.reportSha256) throw new Error(`Packaged Java ${role} report hash does not match release.json`);
      let report;
      try { report = JSON.parse(content.toString('utf8')); } catch { throw new Error(`Packaged Java ${role} report is not valid JSON`); }
      const normalized = normalizeJavaHandoffReport(report, { role, manifest: manifestData.manifest, manifestHash: manifestData.hash });
      if (normalized.commit !== targetEvidence.commit || normalized.v1.inventorySha256 !== targetEvidence.v1InventorySha256) throw new Error(`Packaged Java ${role} report does not match release.json`);
    }
  }
  await validateDeploymentReferences(root, deploymentFiles, { fs: { readFile: operations.readFile }, capturedEntries: capturedFiles });
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

async function copyDependencyEvidence(evidence, stage, operations) {
  for (const path of dependencyEvidenceFiles) {
    const capture = evidence.captures[path];
    await revalidateCapture(capture, 'Dependency evidence', operations);
    await operations.writeFile(join(stage, path), capture.content);
  }
}

async function captureStageIdentity(stage, operations) {
  const files = await walkFiles(stage, '', operations);
  const entries = await fileEntries(stage, files, operations);
  const release = await regularCapture(join(stage, releaseFile), 'release.json', operations);
  return Object.freeze({ files: Object.freeze(entries), releaseBytes: release.bytes, releaseSha256: release.sha256 });
}

async function revalidateFinalStage({ stage, expected, manifestData, inventory, handoffs, javaReports, dependencyEvidence, resolved, gitRunner, operations, capturedIdentity }) {
  await validateCapturedDeploymentInventory(inventory);
  const currentSource = await createDeploymentInventory(resolved.source, manifestData.manifest, { packageVersion: resolved.packageMetadata.version });
  if (currentSource.inventorySha256 !== inventory.inventorySha256) throw new Error('Deployment source changed after release assembly');
  for (const capture of handoffs) await revalidateCapture(capture, 'Release handoff file', operations);
  for (const path of dependencyEvidenceFiles) await revalidateCapture(dependencyEvidence.captures[path], 'Dependency evidence', operations);
  for (const capture of Object.values(dependencyEvidence.sourceCaptures)) await revalidateCapture(capture, 'Dependency evidence source', operations);
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
      try { await operations.rename(backup, target); } catch (restoreError) { throw new Error(`Release replacement failed and backup restoration failed: ${String(error)}; ${String(restoreError)}`, { cause: restoreError }); }
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
  const inventory = await createDeploymentInventory(resolved.source, manifestData.manifest, { packageVersion: resolved.packageMetadata.version });
  const distInventory = resolved.distInventory
    ? await verifyDeploymentInventoryReport({ source: resolved.source, manifestData, manifestPath: manifestData.path, output: resolved.distInventory, projectRoot: resolved.projectRoot })
    : null;
  if (distInventory && distInventory.inventory.sha256 !== inventory.inventorySha256) throw new Error('Deployment inventory changed before release staging');
  const capturedTarget = await targetState(target, manifestData);
  if (!capturedTarget.empty && !resolved.force) throw new Error(`Refusing to replace non-empty release target without --force: ${target}`);
  const handoffs = [];
  for (const [source, destination] of handoffFiles) handoffs.push(Object.freeze({ ...await regularCapture(join(resolved.projectRoot, source), 'Release handoff file', operations), destination }));
  const javaReports = await readJavaReports(resolved, manifestData.manifest, manifestData.hash, operations);
  const dependencyEvidence = await readDependencyEvidence(resolved.projectRoot, operations);
  const javaEvidence = javaEvidenceFor(javaReports);
  const publishable = resolved.tag !== null && !resolved.dirty && javaEvidence.available
    && validCiRunUrl(resolved.ciRunUrl, resolved.repository) && resolved.approvalEnvironment === 'production-release';
  if (resolved.tag && !publishable) throw new Error('Tagged releases require Java evidence, a GitHub CI run URL, and approval environment production-release');
  const capturedComponentContract = await readCapturedDeploymentEntry(inventory.root, inventory.entries.find((entry) => entry.path === componentContractPath));
  validateComponentContractArtifact(capturedComponentContract, resolved.version);
  const componentContract = Object.freeze({ path: componentContractPath, schemaVersion: componentContractSchemaVersion, sha256: sha256(capturedComponentContract) });
  const expected = Object.freeze({ name: resolved.packageMetadata.name, version: resolved.version, commit: resolved.commit, repository: resolved.repository,
    branch: resolved.branch, tag: resolved.tag, dirty: resolved.dirty, publishable, sourceDateEpoch: resolved.sourceDateEpoch, deploymentManifestHash: manifestData.hash,
    componentContract,
    ciRunUrl: resolved.ciRunUrl ?? null, approvalEnvironment: resolved.approvalEnvironment ?? null,
     distInventorySha256: distInventory?.inventory.sha256 ?? null, javaEvidence });
  const expectedWithDependencies = Object.freeze({ ...expected, dependencyEvidence: dependencyEvidence.descriptor });
  const stageParent = dirname(target);
  await operations.mkdir(stageParent, { recursive: true });
  const stage = await operations.mkdtemp(join(stageParent, `.${target.split(sep).pop()}.stage-`));
  try {
    await copyCapturedDeployment(inventory, stage, operations);
     await copyHandoffs(handoffs, stage, operations);
     await copyDependencyEvidence(dependencyEvidence, stage, operations);
    if (javaReports) for (const role of javaRoles) {
      const report = javaReports[role];
      await revalidateCapture(report.source, `Java ${role} report`, operations);
      const output = join(stage, report.path);
      await operations.mkdir(dirname(output), { recursive: true });
      await operations.writeFile(output, report.content);
    }
     const bundleFiles = [...inventory.files, ...handoffs.map((capture) => capture.destination), ...dependencyEvidenceFiles, ...(javaReports ? javaRoles.map((role) => javaReports[role].path) : [])].sort();
    if (distInventory) {
      const rechecked = await verifyDeploymentInventoryReport({ source: resolved.source, manifestData, manifestPath: manifestData.path, output: resolved.distInventory, projectRoot: resolved.projectRoot });
      if (rechecked.inventory.sha256 !== distInventory.inventory.sha256) throw new Error('Deployment inventory changed during release staging');
    }
    const releaseManifest = {
      schemaVersion: releaseSchemaVersion, name: expected.name, version: expected.version, commit: expected.commit,
      source: { repository: expected.repository, branch: expected.branch, tag: expected.tag, dirty: expected.dirty, publishable: expected.publishable },
      sourceDateEpoch: expected.sourceDateEpoch, nodelApi: nodelApiRange,
      deploymentManifest: { path: deploymentManifestName, sha256: manifestData.hash, defaultV1Policy: manifestData.manifest.v1.defaultPolicy, javaTargets: manifestData.manifest.java.targets },
       componentContract, dependencyEvidence: dependencyEvidence.descriptor,
      releaseProcess: { ciRunUrl: resolved.ciRunUrl ?? null, approvalEnvironment: resolved.approvalEnvironment ?? null, distInventorySha256: expected.distInventorySha256 }, javaEvidence,
     inventoryAlgorithm: 'sha256', inventoryExcludes: [releaseFile], files: await fileEntries(stage, bundleFiles, operations)
    };
     const finalExpected = Object.freeze({ ...expectedWithDependencies, filesInventorySha256: sha256(JSON.stringify(releaseManifest.files)) });
    validateReleaseManifest(releaseManifest, finalExpected, manifestData);
    await operations.writeFile(join(stage, releaseFile), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8');
    await verifyReleaseBundle(stage, { operations });
    const capturedStage = await captureStageIdentity(stage, operations);
    const verifyFinalStage = () => revalidateFinalStage({
       stage, expected: finalExpected, manifestData, inventory, handoffs, javaReports, dependencyEvidence, resolved, gitRunner, operations, capturedIdentity: capturedStage
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
