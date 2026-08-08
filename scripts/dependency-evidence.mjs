import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const dependencyEvidenceSchemaVersion = 1;
const sha256 = value => createHash('sha256').update(value).digest('hex');
function json(value) { return JSON.stringify(value, null, 2) + '\n'; }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function fail(message) { throw new Error(message); }
function safeName(value) { return typeof value === 'string' && /^[A-Za-z0-9._@/+-]+$/.test(value) && !value.includes('..'); }
export function compareCodeUnits(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference) return difference;
  }
  return left.length - right.length;
}
function packageNameFromPath(path) {
  const value = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (value.startsWith('@')) return value.split('/').slice(0, 2).join('/');
  return value.split('/')[0];
}
function purl(name, version) { return `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`; }

export async function readLock(projectRoot = process.cwd()) {
  const path = resolve(projectRoot, 'package-lock.json');
  const bytes = await readFile(path);
  let lock;
  try { lock = JSON.parse(bytes); } catch { fail('package-lock.json is not valid JSON'); }
  if (lock.lockfileVersion !== 3 || !record(lock.packages) || !record(lock.packages[''])) fail('Only npm package-lock.json lockfileVersion 3 is supported');
  return { path, bytes, lock, lockHash: sha256(bytes) };
}

function dependencyRequests(item, includePeers = true) {
  const requests = new Map();
  for (const name of [...Object.keys(item.dependencies ?? {}), ...Object.keys(item.optionalDependencies ?? {})]) requests.set(name, { name, optional: false });
  if (includePeers) {
    const optionalPeers = new Set(Object.keys(item.peerOptionalDependencies ?? {}));
    for (const [name, metadata] of Object.entries(item.peerDependenciesMeta ?? {})) if (metadata?.optional === true) optionalPeers.add(name);
    for (const name of Object.keys(item.peerDependencies ?? {})) if (!requests.has(name)) requests.set(name, { name, optional: optionalPeers.has(name) });
    for (const name of Object.keys(item.peerOptionalDependencies ?? {})) if (!requests.has(name)) requests.set(name, { name, optional: true });
  }
  return [...requests.values()].sort((left, right) => compareCodeUnits(left.name, right.name));
}
function locate(lock, parentPath, name) {
  let current = parentPath;
  while (true) {
    const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    const next = current.includes('/node_modules/') ? current.slice(0, current.lastIndexOf('/node_modules/')) : '';
    if (next === current) return null;
    current = next;
  }
}

export function traverseProductionLock(lock) {
  if (!record(lock?.packages) || !record(lock.packages[''])) fail('Lock packages are missing');
  const root = lock.packages[''];
  const queue = dependencyRequests(root, false).map(request => ({ ...request, parent: '' }));
  const paths = new Set();
  while (queue.length) {
    const { name, parent, optional } = queue.shift();
    if (!safeName(name)) fail(`Unsafe package name: ${name}`);
    const path = locate(lock, parent, name);
    if (!path) {
      if (optional) continue;
      fail(`Production dependency is missing from lock: ${name}`);
    }
    if (paths.has(path)) continue;
    const item = lock.packages[path];
    if (item.dev === true && item.devOptional !== true) continue;
    if (typeof item.version !== 'string' || !item.version || typeof item.resolved !== 'string' || typeof item.integrity !== 'string' || typeof item.license !== 'string' || !item.license) {
      fail(`Production package has incomplete lock metadata: ${path}`);
    }
    paths.add(path);
    for (const child of dependencyRequests(item)) queue.push({ ...child, parent: path });
  }
  return [...paths].sort((left, right) => compareCodeUnits(
    purl(packageNameFromPath(left), lock.packages[left].version),
    purl(packageNameFromPath(right), lock.packages[right].version)
  ) || compareCodeUnits(left, right));
}

export function normalizeProductionPackages(lock) {
  return traverseProductionLock(lock).map(path => {
    const item = lock.packages[path];
    const name = packageNameFromPath(path);
    return { name, version: item.version, purl: purl(name, item.version), integrity: item.integrity, license: item.license, path };
  });
}

export function generateSbom({ lock, lockHash }) {
  const packages = normalizeProductionPackages(lock);
  const byPath = new Map(packages.map(pkg => [pkg.path, pkg]));
  const components = packages.map(pkg => {
    const hash = parseIntegrity(pkg.integrity);
    return { type: 'library', "bom-ref": pkg.purl, name: pkg.name, version: pkg.version, purl: pkg.purl, hashes: [{ alg: hash.alg, content: hash.content }], licenses: [{ [pkg.license.includes(' AND ') ? 'expression' : 'license']: pkg.license.includes(' AND ') ? pkg.license : { id: pkg.license } }] };
  });
  const dependencies = packages.map(pkg => {
    const item = lock.packages[pkg.path];
    const dependsOn = dependencyRequests(item).map(({ name }) => locate(lock, pkg.path, name)).filter(path => byPath.has(path)).map(path => byPath.get(path).purl).sort(compareCodeUnits);
    return { ref: pkg.purl, dependsOn: [...new Set(dependsOn)] };
  });
  return { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: { properties: [{ name: 'nodel:package-lock-sha256', value: lockHash }] }, components, dependencies };
}

function parseIntegrity(integrity) {
  if (typeof integrity !== 'string' || !integrity.trim()) fail('Production package has malformed integrity');
  const supported = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
  const tokens = integrity.trim().split(/\s+/);
  const parsed = tokens.map(token => {
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    if (!match) fail(`Unsupported or malformed integrity: ${token}`);
    const encoded = match[2];
    const decoded = Buffer.from(encoded, 'base64');
    if (!decoded.length || decoded.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) fail(`Malformed integrity: ${token}`);
    return { alg: supported[match[1]], strength: Number(match[1].slice(3)), content: decoded.toString('hex') };
  });
  return parsed.sort((left, right) => right.strength - left.strength)[0];
}

function parseNoticeRows(notices) {
  return [...notices.matchAll(/^\| `([^`]+)` \| ([^|]+) \|$/gm)].map(match => ({ pattern: match[1], license: match[2].trim() }));
}
function glob(pattern, value) { return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(value); }
export function reconcileNotices(packages, notices, policy) {
  const rows = parseNoticeRows(notices);
  if (!rows.length) fail('THIRD-PARTY-NOTICES.md has no license table');
  const missing = [], mismatched = [];
  for (const pkg of packages) {
    const row = rows.find(candidate => glob(candidate.pattern, pkg.name));
    if (!row) missing.push(pkg.name);
    else if (row.license !== pkg.license) mismatched.push(`${pkg.name}: ${row.license} != ${pkg.license}`);
  }
  if (policy.noticeRequired && (missing.length || mismatched.length)) fail(`Third-party notice reconciliation failed: missing=${missing.join(',')}; mismatched=${mismatched.join(',')}`);
  return { missing, mismatched, covered: packages.length };
}

export function generateLicenses({ packages, lockHash, policy, policyHash, notices, noticeHash }) {
  for (const pkg of packages) if (!policy.allowedLicenses.includes(pkg.license)) fail(`Disallowed production license ${pkg.license}: ${pkg.name}`);
  const reconciliation = reconcileNotices(packages, notices, policy);
  const summary = Object.fromEntries([...new Set(packages.map(pkg => pkg.license))].sort(compareCodeUnits).map(license => [license, packages.filter(pkg => pkg.license === license).length]));
  return {
    schemaVersion: dependencyEvidenceSchemaVersion,
    lockHash,
    policyHash,
    noticeHash,
     allowedLicenses: [...policy.allowedLicenses].sort(compareCodeUnits),
    licenseSummary: summary,
    noticeReconciliation: reconciliation,
    packages: packages.map(pkg => Object.fromEntries(Object.entries(pkg).filter(([key]) => key !== 'path')))
  };
}

export async function generateDependencyEvidence({ projectRoot = process.cwd(), outputDir = resolve(projectRoot, 'build/dependency-evidence'), policyPath = resolve(projectRoot, 'security/license-policy.json'), noticesPath = resolve(projectRoot, 'THIRD-PARTY-NOTICES.md') } = {}) {
  const { lock, lockHash } = await readLock(projectRoot);
  const policyBytes = await readFile(policyPath); const noticesBytes = await readFile(noticesPath);
  let policy; try { policy = JSON.parse(policyBytes); } catch { fail('license-policy.json is not valid JSON'); }
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.allowedLicenses)) fail('license-policy.json schema is invalid');
  const packages = normalizeProductionPackages(lock);
  const sbom = generateSbom({ lock, lockHash });
  const licenses = generateLicenses({ packages, lockHash, policy, policyHash: sha256(policyBytes), notices: noticesBytes.toString('utf8'), noticeHash: sha256(noticesBytes) });
  return { outputDir, files: { sbom: json(sbom), licenses: json(licenses) }, lockHash, sbom, licenses };
}

export function validateDependencyEvidence({ sbom, licenses, lockHash, policyHash, noticeHash }) {
  if (!record(sbom) || sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5' || sbom.version !== 1 || !Array.isArray(sbom.components) || !Array.isArray(sbom.dependencies)) fail('SBOM is not CycloneDX 1.5');
  if (sbom.metadata?.properties?.[0]?.name !== 'nodel:package-lock-sha256' || sbom.metadata.properties[0].value !== lockHash) fail('SBOM lock hash binding is invalid');
  const refs = sbom.components.map(component => component['bom-ref']);
  if (refs.some((ref, index) => typeof ref !== 'string' || (index && compareCodeUnits(refs[index - 1], ref) > 0))) fail('SBOM components are not sorted');
  if (!record(licenses) || licenses.schemaVersion !== 1 || licenses.lockHash !== lockHash || licenses.policyHash !== policyHash || licenses.noticeHash !== noticeHash || !Array.isArray(licenses.allowedLicenses) || !Array.isArray(licenses.packages) || !record(licenses.licenseSummary) || !record(licenses.noticeReconciliation)) fail('License evidence binding is invalid');
  if (licenses.allowedLicenses.some(license => typeof license !== 'string') || licenses.packages.some((pkg, index) => !record(pkg) || !pkg.name || !pkg.version || !pkg.purl || !pkg.integrity || !pkg.license || !licenses.allowedLicenses.includes(pkg.license) || (index && compareCodeUnits(licenses.packages[index - 1].purl, pkg.purl) > 0))) fail('License evidence packages are invalid or unsorted');
  const summary = Object.fromEntries([...new Set(licenses.packages.map(pkg => pkg.license))].sort(compareCodeUnits).map(license => [license, licenses.packages.filter(pkg => pkg.license === license).length]));
  if (JSON.stringify(summary) !== JSON.stringify(licenses.licenseSummary) || licenses.noticeReconciliation.missing.length !== 0 || licenses.noticeReconciliation.mismatched.length !== 0 || licenses.noticeReconciliation.covered !== licenses.packages.length) fail('License evidence content reconciliation is invalid');
  if (licenses.packages.length !== sbom.components.length || licenses.packages.some((pkg, index) => pkg.purl !== sbom.components[index].purl || pkg.version !== sbom.components[index].version || pkg.license !== (sbom.components[index].licenses?.[0]?.license?.id ?? sbom.components[index].licenses?.[0]?.expression))) fail('SBOM and license evidence package sets differ');
  return true;
}

export { json, sha256 };
