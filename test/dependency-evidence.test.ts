import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// @ts-expect-error Security scripts are intentionally plain Node ESM.
import { normalizeAuditReport, verifyAuditReport } from '../scripts/audit-policy.mjs';
// @ts-expect-error Security scripts are intentionally plain Node ESM.
import { compareCodeUnits, generateDependencyEvidence, generateSbom, generateLicenses, normalizeProductionPackages, validateDependencyEvidence, validateIconSourcesAgainstDependencyEvidence, validateRequiredPublicPackages } from '../scripts/dependency-evidence.mjs';

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

  it('requires a well-formed public package list and preserves every required Font Awesome package', () => {
    const validateRequiredPackages = validateRequiredPublicPackages as unknown as (value: unknown) => string[];
    const fontAwesome = ['@fortawesome/fontawesome-free', '@fortawesome/free-brands-svg-icons', '@fortawesome/free-regular-svg-icons', '@fortawesome/free-solid-svg-icons'];
    const required = [...fontAwesome, '@mdi/svg'];
    expect(validateRequiredPackages(required)).toEqual(required);
    for (const omitted of required) expect(() => validateRequiredPackages(required.filter(name => name !== omitted))).toThrow(/requiredPublicPackages/);
    for (const malformed of [undefined, null, 'not-an-array', [], ['@mdi/svg'], [...required, '@mdi/svg'], [...required, 7], [...required, '@'], [...required, '/'], [...required, '@mdi'], [...required, 'scope/name'], [...required, 'JSONStream']]) {
      expect(() => validateRequiredPackages(malformed)).toThrow(/requiredPublicPackages/);
    }
    expect(validateRequiredPackages([...required, '@valid-scope/valid-package'])).toContain('@valid-scope/valid-package');
  });

  it('rejects required public packages missing from production lock traversal', async () => {
    await mkdir(root, { recursive: true });
    const requiredPublicPackages = ['@fortawesome/fontawesome-free', '@fortawesome/free-brands-svg-icons', '@fortawesome/free-regular-svg-icons', '@fortawesome/free-solid-svg-icons', '@mdi/svg'];
    const lockPackages = Object.fromEntries(requiredPublicPackages.slice(0, 4).map(name => [`node_modules/${name}`, {
      version: '7.3.1', resolved: `https://registry/${name}.tgz`, integrity: 'sha512-YQ==', license: 'MIT'
    }]));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
      '': { dependencies: Object.fromEntries(requiredPublicPackages.slice(0, 4).map(name => [name, '7.3.1'])) },
      ...lockPackages
    } }));
    await writeFile(join(root, 'policy.json'), JSON.stringify({ schemaVersion: 1, allowedLicenses: ['Apache-2.0', 'MIT'], requiredPublicPackages, noticeRequired: true }));
    await writeFile(join(root, 'notices.md'), '| Package | License |\n| --- | --- |\n');
    await expect(generateDependencyEvidence({ projectRoot: root, policyPath: join(root, 'policy.json'), noticesPath: join(root, 'notices.md') })).rejects.toThrow(/Required public production packages are missing from dependencies: @mdi\/svg/);
  });

  it('binds every icon source package version to the validated license evidence', () => {
    const sources = [
      { package: '@fortawesome/fontawesome-free', version: '7.3.1' },
      { package: '@mdi/svg', version: '7.4.47' }
    ];
    const packages = sources.map(source => ({ name: source.package, version: source.version, purl: `pkg:npm/%40${source.package.slice(1)}@${source.version}` }));
    const licenses = { packages };
    const sbom = { components: packages.map(pkg => ({ ...pkg, 'bom-ref': pkg.purl })) };
    expect(() => validateIconSourcesAgainstDependencyEvidence(sources, licenses, sbom)).not.toThrow();
    for (const [index, mismatch] of [[0, '7.3.2'], [1, '8.0.0']] as const) {
      const altered = [...sources];
      altered[index] = { ...sources[index]!, version: mismatch };
      expect(() => validateIconSourcesAgainstDependencyEvidence(altered, licenses, sbom)).toThrow(/Icon source version does not match dependency evidence/);
    }
  });

  it('fails closed for multi-version icon packages regardless of evidence order or selected source version', () => {
    const packages = ['7.4.47', '8.0.0'].map(version => ({ name: '@mdi/svg', version, purl: `pkg:npm/%40mdi/svg@${version}` }));
    for (const ordered of [packages, [...packages].reverse()]) {
      const licenses = { packages: ordered };
      const sbom = { components: ordered.map(pkg => ({ ...pkg, 'bom-ref': pkg.purl })) };
      for (const version of ['7.4.47', '8.0.0']) {
        expect(() => validateIconSourcesAgainstDependencyEvidence([{ package: '@mdi/svg', version }], licenses, sbom)).toThrow(/ambiguous.*@mdi\/svg/i);
      }
    }
  });

  it('allows repeated installations of one exact source identity without rejecting unrelated multiple versions', () => {
    const packages = [
      { name: '@mdi/svg', version: '7.4.47', purl: 'pkg:npm/%40mdi/svg@7.4.47' },
      { name: '@mdi/svg', version: '7.4.47', purl: 'pkg:npm/%40mdi/svg@7.4.47' },
      { name: 'other', version: '1.0.0', purl: 'pkg:npm/other@1.0.0' },
      { name: 'other', version: '2.0.0', purl: 'pkg:npm/other@2.0.0' }
    ];
    const licenses = { packages };
    const sbom = { components: packages.map(pkg => ({ ...pkg, 'bom-ref': pkg.purl })) };
    expect(validateIconSourcesAgainstDependencyEvidence([{ package: '@mdi/svg', version: '7.4.47' }], licenses, sbom)).toBe(true);
  });

  it('traverses legacy uppercase lock names without allowing malformed package paths', () => {
    const legacy = { lockfileVersion: 3, packages: {
      '': { dependencies: { JSONStream: '1.3.5' } },
      'node_modules/JSONStream': { version: '1.3.5', resolved: 'legacy', integrity: 'sha512-YQ==', license: 'MIT' }
    } };
    expect(normalizeProductionPackages(legacy)).toMatchObject([{ name: 'JSONStream', version: '1.3.5', purl: 'pkg:npm/JSONStream@1.3.5' }]);
    const lockHash = 'a'.repeat(64); const policyHash = 'b'.repeat(64); const noticeHash = 'c'.repeat(64);
    const sbom = generateSbom({ lock: legacy, lockHash });
    const licenses = generateLicenses({ packages: normalizeProductionPackages(legacy), lockHash, policy, policyHash, notices: '| `JSONStream` | MIT |\n', noticeHash });
    expect(validateDependencyEvidence({ sbom, licenses, lockHash, policyHash, noticeHash })).toBe(true);
    for (const name of ['@', '/', '@mdi', 'scope/name', '@scope/', '@scope/name/extra', '../escape', 'a/../escape', 'a\\escape']) {
      expect(() => normalizeProductionPackages({ packages: { '': { dependencies: { [name]: '1.0.0' } } } })).toThrow(/Unsafe package name/);
    }
  });

  it.each([
    'license name', 'SBOM name', 'both names', 'license PURL', 'SBOM PURL', 'both PURLs', 'SBOM ref',
    'license version', 'SBOM version', 'both versions', 'version range',
    'license canonical substitution', 'SBOM canonical substitution'
  ])('rejects inconsistent canonical package identity: %s', alteration => {
    const lockHash = 'a'.repeat(64); const policyHash = 'b'.repeat(64); const noticeHash = 'c'.repeat(64);
    const sbom = generateSbom({ lock, lockHash });
    const licenses = generateLicenses({ packages: normalizeProductionPackages(lock), lockHash, policy, policyHash, notices, noticeHash });
    const pkg = licenses.packages[0]; const component = sbom.components[0];
    if (alteration === 'license name' || alteration === 'both names') pkg.name = '@mdi/svg';
    if (alteration === 'SBOM name' || alteration === 'both names') component.name = '@mdi/svg';
    if (alteration === 'license PURL' || alteration === 'both PURLs') pkg.purl = 'pkg:npm/alternate@1.0.0';
    if (alteration === 'SBOM PURL' || alteration === 'both PURLs') component.purl = 'pkg:npm/alternate@1.0.0';
    if (alteration === 'SBOM ref') component['bom-ref'] = 'pkg:npm/alternate@1.0.0';
    if (alteration === 'license version' || alteration === 'both versions') pkg.version = '3.7.1';
    if (alteration === 'SBOM version' || alteration === 'both versions') component.version = '3.7.1';
    if (alteration === 'version range') {
      pkg.version = component.version = '^1.0.0';
      pkg.purl = component.purl = component['bom-ref'] = 'pkg:npm/app@^1.0.0';
    }
    if (alteration === 'license canonical substitution') {
      pkg.name = 'alternate';
      pkg.purl = 'pkg:npm/alternate@1.0.0';
    }
    if (alteration === 'SBOM canonical substitution') {
      component.name = 'alternate';
      component.purl = component['bom-ref'] = 'pkg:npm/alternate@1.0.0';
    }
    expect(() => validateDependencyEvidence({ sbom, licenses, lockHash, policyHash, noticeHash })).toThrow(/identity|package sets differ/i);
    // The source cross-check must not trust an unvalidated alternate name either.
    expect(() => validateIconSourcesAgainstDependencyEvidence([{ package: pkg.name, version: pkg.version }], licenses, sbom)).toThrow(/identity|package sets differ/i);
  });

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

  it('waives only the matching braces advisory before its fixed expiration', async () => {
    await mkdir(root, { recursive: true });
    const exceptionsPath = join(root, 'exceptions.json');
    const exception = { package: 'braces', advisory: '1240992', severity: 'high', expires: '2026-11-08T12:15:00.000Z', reason: 'GHSA-vfj7-8cjw-p6xm affects fixed build globs; no released patch; retain Tailwind 3 browser support and remove after patched install.', owner: 'mcartmel' };
    await writeFile(exceptionsPath, JSON.stringify({ schemaVersion: 1, exceptions: [exception] }));
    const finding = (packageName = 'braces', advisory = '1240992', severity = 'high') => ({ auditReportVersion: 2, vulnerabilities: { [packageName]: { severity, via: [{ source: advisory, title: 'test' }] } } });
    const beforeExpiry = new Date('2026-10-09T12:15:00.000Z');

    await expect(verifyAuditReport(finding(), { exceptionsPath, now: beforeExpiry })).resolves.toMatchObject({ matched: [`braces\0${'1240992'}`] });
    await expect(verifyAuditReport(finding(), { exceptionsPath, now: new Date('2026-11-08T12:15:00.000Z') })).rejects.toThrow(/Expired/);
    await expect(verifyAuditReport(finding(), { exceptionsPath, now: new Date('2026-11-09T12:15:00.000Z') })).rejects.toThrow(/Expired/);
    await expect(verifyAuditReport({ auditReportVersion: 2, vulnerabilities: {} }, { exceptionsPath, now: beforeExpiry })).rejects.toThrow(/Unmatched/);
    await expect(verifyAuditReport(finding('other'), { exceptionsPath, now: beforeExpiry })).rejects.toThrow(/Unmatched/);
    await expect(verifyAuditReport(finding('braces', 'GHSA-other'), { exceptionsPath, now: beforeExpiry })).rejects.toThrow(/Unmatched/);
    await expect(verifyAuditReport(finding('braces', '1240992', 'critical'), { exceptionsPath, now: beforeExpiry })).rejects.toThrow(/Unmatched/);

    await writeFile(exceptionsPath, JSON.stringify({ schemaVersion: 1, exceptions: [exception] }));
    const withOtherFinding = { auditReportVersion: 2, vulnerabilities: {
      braces: { severity: 'high', via: [{ source: '1240992', title: 'waived' }] },
      other: { severity: 'high', via: [{ source: 'GHSA-other', title: 'unwaived' }] }
    } };
    await expect(verifyAuditReport(withOtherFinding, { exceptionsPath, now: beforeExpiry })).rejects.toThrow(/Unmatched high\/critical/);
  });

  it('reconciles the explicit license policy and notices', () => {
    const lockHash = 'a'.repeat(64); const policyHash = 'b'.repeat(64); const noticeHash = 'c'.repeat(64);
    const licenses = generateLicenses({ packages: normalizeProductionPackages(lock), lockHash, policy, policyHash, notices, noticeHash });
    expect(licenses.allowedLicenses).toEqual(['BSD', 'MIT']);
    expect(() => validateDependencyEvidence({ sbom: generateSbom({ lock, lockHash }), licenses, lockHash, policyHash, noticeHash })).not.toThrow();
  });
});
