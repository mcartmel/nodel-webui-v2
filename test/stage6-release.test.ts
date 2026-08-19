// @vitest-environment node

import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateIconArtifacts, validateIconArtifactFiles } from '../scripts/icon-artifact.mjs';
import { verifyPublicRelease } from '../scripts/verify-public-release.mjs';
// @ts-expect-error Release scripts are intentionally plain Node ESM.
import { validateIconSourceVersions } from '../scripts/release-contract.mjs';

function adapter(profile: 'free' | 'pro-local' = 'free') {
  return {
    packageVersion: '0.1.2', profile,
    sources: [
      { package: '@fortawesome/fontawesome-free', version: '7.3.1' },
      { package: '@fortawesome/free-brands-svg-icons', version: '7.3.1' },
      { package: '@fortawesome/free-regular-svg-icons', version: '7.3.1' },
      { package: '@fortawesome/free-solid-svg-icons', version: '7.3.1' }
    ], aliases: {},
    families: [
      { family: 'brands', defaultStyle: 'brands', styles: [{ style: 'brands', icons: [{ iconName: 'brand', icon: [16, 16, [], 'f001', 'M0'] }] }] },
      { family: 'classic', defaultStyle: 'solid', styles: [
        { style: 'regular', icons: [{ iconName: 'regular', icon: [16, 16, [], 'f002', 'M0'] }] },
        { style: 'solid', icons: [{ iconName: 'solid', icon: [16, 16, [], 'f003', 'M0'] }] }
      ] }
    ]
  };
}

function freeArtifact() { return generateIconArtifacts(adapter()); }

async function writeArtifact(root: string, artifact = freeArtifact()) {
  for (const [path, bytes] of artifact.files) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, bytes);
  }
  return artifact;
}

describe('Stage 6 release and public boundary contracts', () => {
  it('rejects non-free profiles wherever the public validator is expected', () => {
    const artifact = generateIconArtifacts(adapter('pro-local'));
    expect(() => validateIconArtifactFiles(artifact.files.get('v2/nodel-icons.json')!, artifact.files, { expectedProfile: 'free' })).toThrow(/profile/);
  });

  it('validates release source descriptors independently of the bound index', () => {
    const valid = adapter().sources;
    expect(() => validateIconSourceVersions(valid)).not.toThrow();
    expect(() => validateIconSourceVersions([{ package: valid[0]!.package, version: valid[0]!.version }, valid[1], valid[1]])).toThrow(/sourceVersions/);
    expect(() => validateIconSourceVersions(valid.map((source, index) => index === 0 ? { ...source, version: '6.0.0' } : source))).toThrow(/one Font Awesome major/);
    expect(() => validateIconSourceVersions(valid.map(source => ({ ...source, version: '7.3' })))).toThrow(/sourceVersions/);
  });

  it('rejects missing, undeclared, and symlinked icon artifact inputs', async () => {
    const artifact = freeArtifact();
    const missing = new Map(artifact.files);
    missing.delete(String(artifact.index.cataloguePath));
    expect(() => validateIconArtifactFiles(artifact.files.get('v2/nodel-icons.json')!, missing, { expectedProfile: 'free' })).toThrow(/missing/i);
    const extra = new Map(artifact.files).set('v2/icons/undeclared.json', Buffer.from('{}'));
    expect(() => validateIconArtifactFiles(artifact.files.get('v2/nodel-icons.json')!, extra, { expectedProfile: 'free' })).toThrow(/undeclared/i);

    const root = join(tmpdir(), `nodel-stage6-symlink-${process.pid}`);
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, 'v2/icons'), { recursive: true });
    await symlink('/tmp', join(root, 'v2/icons/shard.json'));
    const stat = await import('node:fs/promises').then(fs => fs.lstat(join(root, 'v2/icons/shard.json')));
    expect(stat.isSymbolicLink()).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it('guards private dependencies and registry configuration without scanning intentional Pro tooling', async () => {
    const root = join(tmpdir(), `nodel-stage6-public-${process.pid}`);
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));
    await writeArtifact(join(root, 'dist'));
    await mkdir(join(root, 'build/pro-workspace'), { recursive: true });
    await writeFile(join(root, 'build/pro-workspace', 'report.json'), '{"profile":"pro-local"}\n');
    await expect(verifyPublicRelease({ projectRoot: root })).resolves.toMatchObject({ profile: 'free' });
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/fixture': { dependencies: { nested: '1.0.0' } }, 'node_modules/nested': { resolved: 'https://npm.fontawesome.com/private.tgz' } } }));
    await expect(verifyPublicRelease({ projectRoot: root })).rejects.toThrow(/private Font Awesome/);
    for (const packageName of ['@fortawesome/pro-solid-svg-icons', '@fortawesome/sharp-solid-svg-icons', '@fortawesome/duotone-regular-svg-icons', '@fortawesome/private-kit-icons', 'fontawesome-pro', 'fontawesome-pro-duotone']) {
      await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { [packageName]: 'file:../fixture.tgz' } }, [`node_modules/${packageName}`]: { version: '0.0.0', resolved: 'file:../fixture.tgz' } } }));
      await expect(verifyPublicRelease({ projectRoot: root })).rejects.toThrow(/private Font Awesome/);
    }
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }));
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@fortawesome/pro-light-svg-icons': 'file:../fixture.tgz' } }));
    await expect(verifyPublicRelease({ projectRoot: root })).rejects.toThrow(/private Font Awesome/);
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
    await writeFile(join(root, '.npmrc'), '@fortawesome:registry=https://npm.fontawesome.com/\n');
    await expect(verifyPublicRelease({ projectRoot: root })).rejects.toThrow(/registry/);
    await rm(join(root, '.npmrc'));
    await writeFile(join(root, 'dist', 'v2', 'icons', 'extra.json'), '{}\n');
    await expect(verifyPublicRelease({ projectRoot: root })).rejects.toThrow(/undeclared/i);
    await rm(root, { recursive: true, force: true });
  });
});
