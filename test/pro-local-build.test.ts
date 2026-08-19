// @vitest-environment node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
// @ts-expect-error Pro-local tooling intentionally remains Node ESM.
import { adaptProIconSource, bootstrapProPackage, parseProBuildArgs, redactProError, runProBuild, sanitizeProChildEnvironment } from '../scripts/pro-local-build.mjs';
// @ts-expect-error Deployment scripts are intentionally plain Node ESM.
import { createDeploymentInventory, loadDeploymentManifest } from '../scripts/deployment-contract.mjs';

const fixtureIconNames = ['circle-check', 'circle-info', 'power-off', 'triangle-exclamation', 'volume-high'];
const fixtureRoot = resolve('build/pro-local-build-test');
const execFileAsync = promisify(execFile);

async function treeHash(root: string, relativePath = ''): Promise<string> {
  const information = await lstat(root).catch(() => null);
  if (!information) return 'absent';
  const hash = createHash('sha256');
  async function visit(path: string, current: string): Promise<void> {
    const entry = await lstat(path);
    hash.update(`${current}\0${entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'}\0`);
    if (entry.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await visit(join(path, child), current ? `${current}/${child}` : child);
    } else if (entry.isFile()) {
      hash.update(await readFile(path));
    }
  }
  await visit(root, relativePath);
  return hash.digest('hex');
}

type FixtureLayout = 'flat' | 'nested';
type FixtureIcon = { label: string; unicode: string; search: { terms: string[] }; styles: string[] };

function svgDirectory(root: string, family: string, style: string, layout: FixtureLayout) {
  if (family === 'brands') return join(root, 'svgs', 'brands');
  if (layout === 'nested') return join(root, 'svgs', family, style);
  if (family === 'duotone' && style === 'solid') return join(root, 'svgs', 'duotone');
  return join(root, 'svgs', family === 'classic' ? style : `${family}-${style}`);
}

function vendorStyle(family: string, style: string) {
  return family === 'classic' || family === 'brands' ? style : `${family}-${style}`;
}

async function writeIcon(root: string, family: string, style: string, name: string, path = 'M0 0', layout: FixtureLayout = 'flat') {
  const directory = svgDirectory(root, family, style, layout);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Font Awesome Pro license notice -->\n<svg viewBox="0 0 16 16"><path d="${path}"/></svg>`);
}

async function writeProFixture(root: string, metadataFormat: 'json' | 'yml' = 'json', layout: FixtureLayout = 'flat') {
  await mkdir(join(root, 'metadata'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fortawesome/fontawesome-pro', version: '7.3.2' }));
  const metadata: Record<string, FixtureIcon> = {};
  for (const name of fixtureIconNames) {
    metadata[name] = { label: name, unicode: 'f001', search: { terms: [name] }, styles: ['solid'] };
    await writeIcon(root, 'classic', 'solid', name, 'M0 0', layout);
  }
  for (const style of ['regular', 'light', 'thin']) {
    const name = `classic-${style}-icon`;
    metadata[name] = { label: name, unicode: 'f002', search: { terms: [style] }, styles: [style] };
    await writeIcon(root, 'classic', style, name, 'M0 0', layout);
  }
  for (const family of ['duotone', 'sharp', 'sharp-duotone']) {
    for (const style of ['solid', 'regular', 'light', 'thin']) {
      const name = `${family}-${style}-icon`;
      metadata[name] = { label: name, unicode: 'f002', search: { terms: [family, style] }, styles: [vendorStyle(family, style)] };
      await writeIcon(root, family, style, name, 'M0 0', layout);
    }
  }
  metadata['power-off'] = { label: 'Dungeons & Dragons', unicode: 'f001', search: { terms: ['CI/CD', '%', "O'Reilly", 'https://fontawesome.com/icons/power-off', 'Café'] }, styles: ['solid'] };
  metadata.github = { label: 'Pro GitHub', unicode: 'f003', search: { terms: ['github'] }, styles: ['brands'] };
  await writeIcon(root, 'brands', 'brands', 'github', 'M1 1', layout);
  if (metadataFormat === 'json') {
    await writeFile(join(root, 'metadata', 'icons.json'), JSON.stringify(metadata));
    return;
  }
  const yaml = Object.entries(metadata).map(([name, icon]) => [
    `# Font Awesome all-inclusive package metadata for ${name}`,
    `${name}:`,
    `  label: ${icon.label}`,
    `  unicode: ${icon.unicode}`,
    '  search:',
    '    terms:',
    ...icon.search.terms.map(term => `      - ${term}`),
    '  styles:',
    ...icon.styles.map(style => `    - ${style}`)
  ].join('\n')).join('\n');
  await writeFile(join(root, 'metadata', 'icons.yml'), `%YAML 1.2\n---\n${yaml}\n`);
}

describe('Pro-local icon adapter', () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(fixtureRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('discovers every recognized Pro family and lets Pro Brands win collisions', async () => {
    const sourceRoot = join(fixtureRoot, 'extracted-pro');
    await writeProFixture(sourceRoot);
    const adapter = await adaptProIconSource({
      sourceRoot,
      publicVersion: '7.3.1',
      freeBrands: {
        version: '7.3.1',
        icons: [{ iconName: 'github', label: 'Free GitHub', icon: [16, 16, [], 'f004', 'M2'] }, { iconName: 'free-brand', icon: [16, 16, [], 'f005', 'M3'] }],
        metadataSource: { package: '@fortawesome/fontawesome-free', version: '7.3.1', metadata: {
          github: { label: 'Official Free GitHub', search: { terms: ['github'] } },
          'free-brand': { label: 'Official Free Brand', search: { terms: ['official-free-brand-term'] } }
        } }
      }
    });
    expect(adapter.profile).toBe('pro-local');
    expect(adapter.sources).toEqual([
      { package: '@fortawesome/fontawesome-free', version: '7.3.1' },
      { package: '@fortawesome/fontawesome-pro', version: '7.3.2' },
      { package: '@fortawesome/free-brands-svg-icons', version: '7.3.1' }
    ]);
    expect(adapter.families.map((family: { family: string }) => family.family).sort()).toEqual(['brands', 'classic', 'duotone', 'sharp', 'sharp-duotone']);
    for (const family of adapter.families.filter((family: { family: string }) => family.family !== 'brands') as Array<{ styles: Array<{ style: string }> }>) {
      expect(family.styles.map(style => style.style).sort()).toEqual(['light', 'regular', 'solid', 'thin']);
    }
    const brands = adapter.families.find((family: { family: string }) => family.family === 'brands') as { styles: Array<{ icons: Array<{ iconName: string; label?: string }> }> };
    expect(brands.styles[0]?.icons.find(icon => icon.iconName === 'github')?.label).toBe('Pro GitHub');
    expect(brands.styles[0]?.icons.some(icon => icon.iconName === 'free-brand')).toBe(true);
    expect(brands.styles[0]?.icons.find(icon => icon.iconName === 'free-brand')).toMatchObject({ label: 'Official Free Brand', searchTerms: ['official-free-brand-term'] });
  });

  it('accepts documented all-inclusive YAML metadata and XML license layout but rejects unsafe XML', async () => {
    const sourceRoot = join(fixtureRoot, 'all-inclusive-pro');
    await writeProFixture(sourceRoot, 'yml');
    const adapter = await adaptProIconSource({ sourceRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [], metadataSource: { package: '@fortawesome/fontawesome-free', version: '7.3.1', metadata: {} } } });
    const classic = (adapter as { families: Array<{ family: string; styles: Array<{ style: string; icons: Array<{ iconName: string }> }> }> }).families.find(family => family.family === 'classic');
    const power = classic!.styles.find(style => style.style === 'solid')!.icons.find(icon => icon.iconName === 'power-off');
    expect(power).toMatchObject({ label: 'Dungeons & Dragons', searchTerms: expect.arrayContaining(['CI/CD', '%', "O'Reilly", 'https://fontawesome.com/icons/power-off', 'Café']) });
    await writeFile(join(sourceRoot, 'metadata', 'icons.json'), '{}');
    await expect(adaptProIconSource({ sourceRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [], metadataSource: { package: '@fortawesome/fontawesome-free', version: '7.3.1', metadata: {} } } })).rejects.toThrow(/Incomplete Font Awesome metadata/);
    await rm(join(sourceRoot, 'metadata', 'icons.json'));
    await writeFile(join(sourceRoot, 'svgs', 'solid', 'power-off.svg'), '<!DOCTYPE svg><svg viewBox="0 0 16 16"><path d="M0"/></svg>');
    await expect(adaptProIconSource({ sourceRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [], metadataSource: { package: '@fortawesome/fontawesome-free', version: '7.3.1', metadata: {} } } })).rejects.toThrow(/Malformed Font Awesome SVG/);
  });

  it('accepts the unambiguous nested compatibility layout', async () => {
    const sourceRoot = join(fixtureRoot, 'nested-pro');
    await writeProFixture(sourceRoot, 'json', 'nested');
    await expect(adaptProIconSource({ sourceRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [] } })).resolves.toMatchObject({ profile: 'pro-local' });
  });

  it('fails closed for incomplete, duplicate, and unknown family layouts and unsupported majors', async () => {
    const sourceRoot = join(fixtureRoot, 'incomplete-pro');
    await writeProFixture(sourceRoot);
    await rm(join(sourceRoot, 'svgs', 'sharp-duotone-regular'), { recursive: true });
    await expect(adaptProIconSource({ sourceRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [] } })).rejects.toThrow(/missing required/);
    let viteInvoked = false;
    await expect(runProBuild({
      environment: { ...process.env, NODEL_FONTAWESOME_PRO_DIR: sourceRoot, FONTAWESOME_PACKAGE_TOKEN: '' },
      run: async () => { viteInvoked = true; return { stdout: '', stderr: '' }; }
    })).rejects.toThrow(/missing required/);
    expect(viteInvoked).toBe(false);
    await writeProFixture(sourceRoot);
    await expect(adaptProIconSource({ sourceRoot, publicVersion: '8.0.0', freeBrands: { version: '8.0.0', icons: [] } })).rejects.toThrow(/supported public/);
    const metadataPath = join(sourceRoot, 'metadata', 'icons.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, { styles: string[] }>;
    metadata['power-off']!.styles = ['regular'];
    await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(adaptProIconSource({ sourceRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [] } })).rejects.toThrow(/Incomplete Font Awesome metadata/);

    const duplicateRoot = join(fixtureRoot, 'duplicate-pro');
    await writeProFixture(duplicateRoot);
    await mkdir(join(duplicateRoot, 'svgs', 'classic', 'solid'), { recursive: true });
    await expect(adaptProIconSource({ sourceRoot: duplicateRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [] } })).rejects.toThrow(/Duplicate Font Awesome family\/style layout/);

    const unknownRoot = join(fixtureRoot, 'unknown-pro');
    await writeProFixture(unknownRoot);
    await mkdir(join(unknownRoot, 'svgs', 'sharp-blue'), { recursive: true });
    await expect(adaptProIconSource({ sourceRoot: unknownRoot, publicVersion: '7.3.1', freeBrands: { version: '7.3.1', icons: [] } })).rejects.toThrow(/Unknown Font Awesome SVG layout/);
  });

  it('rejects direct Pro-mode Vite builds without prepared validated assets', async () => {
    await rm(resolve('build/icon-assets/pro-local'), { recursive: true, force: true });
    await expect(execFileAsync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--mode', 'pro-local'], { cwd: resolve('.') }))
      .rejects.toThrow(/pro-local icon assets are missing/);
  });

  it('builds a synthetic directory source only into the Pro-local output', async () => {
    const sourceRoot = join(fixtureRoot, 'preview-pro');
    await writeProFixture(sourceRoot);
    const publicDistBefore = await treeHash(resolve('dist'));
    const publicGraph = resolve('build/bundle-graph.json');
    const proGraph = resolve('build/pro-reports/bundle-graph.json');
    const publicGraphBytes = Buffer.from('{"public":"preserve"}\n');
    const previousProGraphBytes = Buffer.from('{"pro":"replace"}\n');
    await mkdir(resolve('build'), { recursive: true });
    await mkdir(resolve('build/pro-reports'), { recursive: true });
    await writeFile(publicGraph, publicGraphBytes);
    await writeFile(proGraph, previousProGraphBytes);
    await execFileAsync(process.execPath, ['scripts/pro-local-build.mjs'], {
      cwd: resolve('.'),
      env: { ...process.env, NODEL_FONTAWESOME_PRO_DIR: sourceRoot, FONTAWESOME_PACKAGE_TOKEN: '' }
    });
    const index = JSON.parse(await readFile(resolve('build/pro-dist/v2/nodel-icons.json'), 'utf8')) as { profile: string; sources: Array<{ package: string; version: string }> };
    expect(index.profile).toBe('pro-local');
    expect(index.sources).toEqual(expect.arrayContaining([
      { package: '@fortawesome/fontawesome-free', version: '7.3.1' },
      { package: '@fortawesome/free-brands-svg-icons', version: '7.3.1' },
      { package: '@fortawesome/fontawesome-pro', version: '7.3.2' }
    ]));
    expect(await treeHash(resolve('dist'))).toBe(publicDistBefore);
    expect(await readFile(publicGraph)).toEqual(publicGraphBytes);
    expect(JSON.parse(await readFile(proGraph, 'utf8'))).toMatchObject({ schemaVersion: 1 });
    expect(await readdir(resolve('build/pro-dist'))).not.toContain('bundle-graph.json');
    const manifest = await loadDeploymentManifest(resolve('deployment-manifest.json'));
    await expect(createDeploymentInventory(resolve('build/pro-dist'), manifest.manifest, { packageVersion: '0.1.2', expectedIconProfile: 'pro-local' })).resolves.toMatchObject({ root: resolve('build/pro-dist') });
    const proGraphBytes = await readFile(proGraph);
    await execFileAsync(process.execPath, ['scripts/generate-icon-assets.mjs'], { cwd: resolve('.') });
    await execFileAsync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--mode', 'public'], { cwd: resolve('.') });
    expect(await readFile(proGraph)).toEqual(proGraphBytes);
    const packageScripts = JSON.parse(await readFile(resolve('package.json'), 'utf8')).scripts as Record<string, string>;
    expect(packageScripts['deploy:local:pro']).toContain('build/pro-dist/');
    expect(packageScripts['deploy:local:pro']).not.toContain('pro-reports');
  }, 120_000);

  it('invokes the release gate verifier against Pro-local output with explicit pro-local profile', async () => {
    const sourceRoot = join(fixtureRoot, 'gate-pro');
    await writeProFixture(sourceRoot);
    const observed: Array<{ distRoot?: string; expectedIconProfile?: string }> = [];
    const runResult = await runProBuild({
      environment: { ...process.env, NODEL_FONTAWESOME_PRO_DIR: sourceRoot, FONTAWESOME_PACKAGE_TOKEN: '' },
      run: async () => ({ stdout: '', stderr: '' }),
      verifyReleaseGate: async (options: { distRoot?: string; expectedIconProfile?: string }) => {
        observed.push(options);
        return true;
      }
    });
    expect(runResult).toEqual({ profile: 'pro-local', sourceVersion: '7.3.2' });
    expect(observed).toEqual([{
      distRoot: resolve('build/pro-dist'),
      expectedIconProfile: 'pro-local'
    }]);
  });
});

describe('Pro-local token bootstrap sanitization', () => {
  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('accepts only exact versions and strips credential and Vite variables from children', () => {
    expect(parseProBuildArgs([], { defaultVersion: '7.3.1' })).toEqual({ version: '7.3.1' });
    expect(parseProBuildArgs(['--version', '7.3.1-rc.1+local'], { defaultVersion: '7.3.1' })).toEqual({ version: '7.3.1-rc.1+local' });
    expect(() => parseProBuildArgs(['--version', '^7.3.1'], { defaultVersion: '7.3.1' })).toThrow(/exact SemVer/);
    expect(() => parseProBuildArgs(['--version', '07.3.1'], { defaultVersion: '7.3.1' })).toThrow(/exact SemVer/);
    const environment = sanitizeProChildEnvironment({ PATH: '/bin', fontawesome_package_token: 'fixture-only', VITE_SECRET: 'fixture-only', NpM_CoNfIg_ReGiStRy: 'bad', NODE_AUTH_TOKEN: 'fixture-only' }, { SAFE: 'yes' });
    expect(environment).toEqual({ PATH: '/bin', SAFE: 'yes' });
    expect(redactProError(new Error('npm token=fixture-only-token'), 'fixture-only-token')).toBe('npm token=[redacted]');
  });

  it('uses a mode-0600 temporary npm config and removes it after the isolated install', async () => {
    const workspaceRoot = join(fixtureRoot, 'workspace');
    let configPath = '';
    await bootstrapProPackage({
      token: 'fixture-only-token',
      version: '7.3.1',
      workspaceRoot,
      environment: { PATH: process.env.PATH ?? '', FONTAWESOME_PACKAGE_TOKEN: 'fixture-only-token', VITE_SECRET: 'fixture-only' },
      run: async (_command: string, _args: string[], options: { cwd: string; env: Record<string, string> }) => {
        configPath = options.env.NPM_CONFIG_USERCONFIG!;
        expect(options.env.FONTAWESOME_PACKAGE_TOKEN).toBeUndefined();
        expect(options.env.VITE_SECRET).toBeUndefined();
        expect((await stat(configPath)).mode & 0o777).toBe(0o600);
        const installed = join(options.cwd, 'node_modules', '@fortawesome', 'fontawesome-pro');
        await mkdir(installed, { recursive: true });
        await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@fortawesome/fontawesome-pro', version: '7.3.1' }));
        return { stdout: '', stderr: '' };
      }
    });
    await expect(access(configPath)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8')).private).toBe(true);

    let failedConfigPath = '';
    let failure = '';
    await bootstrapProPackage({
      token: 'fixture-only-token',
      version: '7.3.1',
      workspaceRoot: join(fixtureRoot, 'failed-workspace'),
      run: async (_command: string, _args: string[], options: { env: Record<string, string> }) => {
        failedConfigPath = options.env.NPM_CONFIG_USERCONFIG!;
        throw new Error('private registry token=fixture-only-token failed');
      }
    }).catch((error: unknown) => { failure = String(error); });
    expect(failure).toContain('[redacted]');
    expect(failure).not.toContain('fixture-only-token');
    await expect(access(failedConfigPath)).rejects.toThrow();
  });
});
