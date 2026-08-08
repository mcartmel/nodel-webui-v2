import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error Security scripts are intentionally plain Node ESM.
import { normalizeAuditReport, verifyAuditReport } from '../scripts/audit-policy.mjs';
// @ts-expect-error Security scripts are intentionally plain Node ESM.
import { compareCodeUnits, generateSbom, generateLicenses, normalizeProductionPackages, validateDependencyEvidence } from '../scripts/dependency-evidence.mjs';

const root = join(process.cwd(), 'build', 'dependency-evidence-test');
const lock = { lockfileVersion: 3, packages: {
  '': { dependencies: { app: '1.0.0' } },
  'node_modules/app': { version: '1.0.0', resolved: 'https://registry/app.tgz', integrity: 'sha512-YQ==', license: 'MIT', dependencies: { identicon: '2.0.0' } },
  'node_modules/identicon': { version: '2.0.0', resolved: 'https://registry/identicon.tgz', integrity: 'sha512-Yg==', license: 'BSD' }
} };
const policy = { schemaVersion: 1, allowedLicenses: ['BSD', 'MIT'], noticeRequired: true };
const notices = '| Package | License |\n| --- | --- |\n| `app` | MIT |\n| `identicon` | BSD |\n';
type TestLock = { packages: Record<string, Record<string, unknown>> };

describe('dependency evidence', () => {
  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('traverses only production lock dependencies and emits deterministic SBOM data', () => {
    const packages = normalizeProductionPackages(lock);
    expect(packages.map((pkg: { name: string }) => pkg.name)).toEqual(['app', 'identicon']);
    const lockHash = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
    const first = JSON.stringify(generateSbom({ lock, lockHash }));
    const second = JSON.stringify(generateSbom({ lock, lockHash }));
    expect(first).toBe(second);
    expect(first).not.toMatch(/timestamp|serialNumber|lock-path|hostname/i);
    expect(generateSbom({ lock, lockHash }).components[0].hashes[0]).toEqual({ alg: 'SHA-512', content: '61' });
  });

  it('follows required and installed optional peers using the lock hierarchy', () => {
    const peerLock = { lockfileVersion: 3, packages: {
      '': { dependencies: { host: '1.0.0', duplicate: '1.0.0' } },
      'node_modules/host': { version: '1.0.0', resolved: 'host', integrity: 'sha512-YQ==', license: 'MIT', dependencies: { duplicate: '2.0.0' }, peerDependencies: { required: '1.0.0', optional: '1.0.0' }, peerDependenciesMeta: { optional: { optional: true } }, peerOptionalDependencies: { missing: '1.0.0' } },
      'node_modules/required': { version: '1.0.0', resolved: 'required', integrity: 'sha512-Yg==', license: 'MIT' },
      'node_modules/optional': { version: '1.0.0', resolved: 'optional', integrity: 'sha512-Yg==', license: 'MIT' },
      'node_modules/duplicate': { version: '1.0.0', resolved: 'duplicate-1', integrity: 'sha512-Yg==', license: 'MIT' },
      'node_modules/host/node_modules/duplicate': { version: '2.0.0', resolved: 'duplicate-2', integrity: 'sha512-Yg==', license: 'MIT' }
    } };
    const packages = normalizeProductionPackages(peerLock);
    expect(packages.map((pkg: { name: string; version: string }) => `${pkg.name}@${pkg.version}`)).toEqual([
      'duplicate@1.0.0', 'duplicate@2.0.0', 'host@1.0.0', 'optional@1.0.0', 'required@1.0.0'
    ]);
    const sbom = generateSbom({ lock: peerLock, lockHash: 'a'.repeat(64) });
    expect(sbom.dependencies.find((dependency: { ref: string; dependsOn: string[] }) => dependency.ref === 'pkg:npm/host@1.0.0')?.dependsOn).toEqual([
      'pkg:npm/duplicate@2.0.0', 'pkg:npm/optional@1.0.0', 'pkg:npm/required@1.0.0'
    ]);
    expect(JSON.stringify(sbom)).not.toContain('missing');
  });

  it('rejects missing required peers and malformed or unsupported integrity', () => {
    const missingPeer = structuredClone(lock) as unknown as TestLock;
    missingPeer.packages['node_modules/app']!.peerDependencies = { required: '1.0.0' };
    expect(() => normalizeProductionPackages(missingPeer)).toThrow(/missing from lock: required/);

    const malformed = structuredClone(lock);
    malformed.packages['node_modules/app'].integrity = 'sha512-not base64';
    expect(() => generateSbom({ lock: malformed, lockHash: 'a'.repeat(64) })).toThrow(/Malformed integrity|Unsupported or malformed integrity/);
    const unsupported = structuredClone(lock);
    unsupported.packages['node_modules/app'].integrity = 'md5-YQ==';
    expect(() => generateSbom({ lock: unsupported, lockHash: 'a'.repeat(64) })).toThrow(/Unsupported or malformed integrity/);
  });

  it('uses locale-independent code-unit ordering', () => {
    expect(['a', 'Z', 'é', 'aa'].sort(compareCodeUnits)).toEqual(['Z', 'a', 'aa', 'é']);
    expect(compareCodeUnits('Z', 'a')).toBeLessThan(0);
    const prefixLock = { lockfileVersion: 3, packages: {
      '': { dependencies: { yargs: '1.0.0', 'yargs-parser': '1.0.0' } },
      'node_modules/yargs': { version: '1.0.0', resolved: 'yargs', integrity: 'sha512-YQ==', license: 'MIT' },
      'node_modules/yargs-parser': { version: '1.0.0', resolved: 'yargs-parser', integrity: 'sha512-Yg==', license: 'MIT' }
    } };
    expect(generateSbom({ lock: prefixLock, lockHash: 'a'.repeat(64) }).components.map((component: { purl: string }) => component.purl)).toEqual([
      'pkg:npm/yargs-parser@1.0.0', 'pkg:npm/yargs@1.0.0'
    ]);
  });

  it('blocks high findings and rejects malformed or unmatched exceptions', async () => {
    const audit = { auditReportVersion: 2, vulnerabilities: { app: { severity: 'high', via: [{ source: 'GHSA-test', title: 'test' }] } } };
    await expect(verifyAuditReport(audit, { exceptionsPath: join(root, 'missing.json') })).rejects.toThrow(/audit-exceptions/);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'exceptions.json'), JSON.stringify({ schemaVersion: 1, exceptions: [{ package: 'other', advisory: 'GHSA-other', severity: 'high', expires: '2099-01-01T00:00:00.000Z', reason: 'test', owner: 'security' }] }));
    await expect(verifyAuditReport(audit, { exceptionsPath: join(root, 'exceptions.json') })).rejects.toThrow(/Unmatched/);
    expect(normalizeAuditReport({ auditReportVersion: 2, vulnerabilities: {} })).toEqual([]);
  });

  it('reconciles the explicit license policy and notices', () => {
    const lockHash = 'a'.repeat(64); const policyHash = 'b'.repeat(64); const noticeHash = 'c'.repeat(64);
    const licenses = generateLicenses({ packages: normalizeProductionPackages(lock), lockHash, policy, policyHash, notices, noticeHash });
    expect(licenses.allowedLicenses).toEqual(['BSD', 'MIT']);
    expect(() => validateDependencyEvidence({ sbom: generateSbom({ lock, lockHash }), licenses, lockHash, policyHash, noticeHash })).not.toThrow();
  });
});
