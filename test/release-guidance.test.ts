import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface CiActionManifestEntry {
  name: string;
  version: string;
  sha: string;
}

interface CiActionManifest {
  schemaVersion: number;
  actions: CiActionManifestEntry[];
}

function validateCiActionsManifest(value: unknown, workflows: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CI action manifest must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== 'actions\0schemaVersion') throw new Error('CI action manifest has unexpected fields');
  if (record.schemaVersion !== 1 || !Array.isArray(record.actions)) throw new Error('CI action manifest schema is invalid');

  const actions = record.actions as unknown[];
  const approved = new Map<string, CiActionManifestEntry>();
  const shas = new Set<string>();
  for (const value of actions) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CI action entry must be an object');
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).sort().join('\0') !== 'name\0sha\0version') throw new Error('CI action entry has unexpected fields');
    if (typeof entry.name !== 'string' || !/^actions\/[a-z0-9-]+$/.test(entry.name)) throw new Error('CI action name is invalid');
    if (typeof entry.version !== 'string' || !/^v\d+\.\d+\.\d+$/.test(entry.version)) throw new Error('CI action version is invalid');
    if (typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) throw new Error('CI action SHA is invalid');
    if (approved.has(entry.name)) throw new Error(`Duplicate CI action name: ${entry.name}`);
    if (shas.has(entry.sha)) throw new Error(`Duplicate CI action SHA: ${entry.sha}`);
    const approvedEntry = entry as unknown as CiActionManifestEntry;
    approved.set(approvedEntry.name, approvedEntry);
    shas.add(approvedEntry.sha);
  }
  if ([...approved.keys()].join('\0') !== [...approved.keys()].sort().join('\0')) throw new Error('CI action entries must be sorted by name');

  const used = new Set<string>();
  for (const workflow of workflows) {
    for (const line of workflow.split('\n').filter((candidate) => candidate.includes('uses:'))) {
      const match = line.match(/^\s*uses:\s+([^\s#]+)\s+#\s*(v\d+\.\d+\.\d+)\s*$/);
      if (!match) throw new Error(`Malformed uses line: ${line}`);
      const specifier = match[1];
      const version = match[2];
      if (!specifier || !version) throw new Error(`Incomplete uses line: ${line}`);
      const parts = specifier.split('@');
      if (parts.length !== 2) throw new Error(`Malformed action specifier: ${specifier}`);
      const [name, sha] = parts;
      if (!name || !sha || !/^actions\/[a-z0-9-]+$/.test(name)) throw new Error(`Unapproved action owner: ${specifier}`);
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Mutable or malformed action reference: ${specifier}`);
      const entry = approved.get(name);
      if (!entry) throw new Error(`Missing CI action approval: ${name}`);
      if (entry.sha !== sha || entry.version !== version) throw new Error(`CI action approval mismatch: ${name}`);
      used.add(name);
    }
  }
  for (const name of approved.keys()) if (!used.has(name)) throw new Error(`Unused CI action approval: ${name}`);
  return value as CiActionManifest;
}

describe('V1 migration and release guidance', () => {
  it('documents every Stage 9 migration mapping', async () => {
    const guidance = await readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8');
    const mappings = [
      ['`showevent` + `showeventarg`', '`visibility="Signal.path"`'],
      ['`showvalue`', '`visible-value` / `visible-values`'],
      ['`confirm="code"`', '`confirm-mode="code"`'],
      ['`<link url>`', '`<nodel-link href>`'],
      ['`<link node>`', '`<nodel-link node>`'],
      ['Parent status event link', '`<nodel-link event-binding>`'],
      ['`<page action>`', '`nodel-page action` / `actions`'],
      ['`<status page>`', '`<nodel-link href="#PageId">`'],
      ['`<footer>`', '`nodel-footer`'],
      ['`<panel event>`', '`nodel-markdown signal`'],
      ['Magic `Title`', '`nodel-app signal` / `signals`'],
      ['Magic `Clock`', '`nodel-clock signal`'],
      ['`range type="mute"`', '`nodel-fader` and `nodel-toggle`'],
      ['Bootstrap push/pull', '`order`']
    ];

    for (const [legacy, replacement] of mappings) {
      expect(guidance, legacy).toContain(legacy);
      expect(guidance, replacement).toContain(replacement);
    }
  });

  it('documents intentional exclusions and required release caveats', async () => {
    const guidance = await readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8');
    const releaseNotes = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8');
    const architecture = await readFile(resolve(process.cwd(), 'docs/architecture.md'), 'utf8');

    for (const phrase of [
      'Node search inside the node drawer',
      'Integrated range mute',
      'Arbitrary Font Awesome or Glyphicon class names',
      'Smart-panel detection, forced zoom, and touch workarounds',
      'Native V1 XML/XSL rendering in V2',
      'Automatic `pages/@css` and `pages/@js` loading',
      'Blocking offline UI on core pages'
    ]) {
      expect(guidance).toContain(phrase);
    }
    expect(guidance).toContain('case-sensitively');
    expect(guidance).toContain('not an authorization boundary');
    expect(guidance).toContain('does not remove the legacy V1 path');
    expect(releaseNotes).toContain('blocking offline modal');
    expect(releaseNotes).toContain('case-sensitive');
    expect(releaseNotes).toContain('does not replace backend authentication or authorization');
    expect(releaseNotes).toContain('legacy V1 loader');
    expect(architecture).toContain('`RELEASE_NOTES.md`');
    expect(architecture).toContain('does not make Java Nodel\'s unlocked, unconditional script write atomic');
    expect(architecture).toContain('does not delete an incomplete destination automatically');
    expect(architecture).toContain('creation returns no ownership token');
    expect(architecture).toContain('normal explicitly confirmed node-removal workflow');
  });

  it('documents Stage 7 contracts, recovery, coverage, and evidence', async () => {
    const guidance = await readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8');
    const notes = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8');
    const architecture = await readFile(resolve(process.cwd(), 'docs/architecture.md'), 'utf8');
    for (const phrase of [
      'recommended custom UI first', 'advanced core assistance', 'hidden internal entries', 'Ctrl/Cmd+Space',
      'arbitrary Tailwind output', 'does not call action or signal endpoints', 'infer or index point names',
      'Empty, node-only, target-only, and complete binding rows', 'incomplete rows remain inactive and unwired',
      'invalid typed or enum values still block', 'preserves unknown metadata', 'do not block Save',
      'schemaVersion', 'element audience', 'ignoring unknown additive fields', 'initialization-time navigation inputs',
      '/REST/nodeURLs', 'target-node `REST/actions` or `REST/events`'
    ]) expect(guidance).toContain(phrase);
    for (const phrase of [
      'Component Contract Data Flow', 'Editor Authoring Pipeline', 'Lazy Component Failure Path',
      'Quality And Coverage Policy', 'Decomposition Boundaries', 'SBOM.cdx.json', 'THIRD-PARTY-LICENSES.json',
      '90% lines', '85% branches', 'fifth hotspot boundary'
    ]) expect(architecture).toContain(phrase);
    for (const phrase of [
      '**Breaking:**', '**Additive:**', '**Informational/operational:**', 'Native HTML/XML completion',
      'generation-deduplicated app toast', 'CycloneDX `SBOM.cdx.json`', 'schema-5 hash binding',
      'no automatic ratchet'
    ]) expect(notes).toContain(phrase);
    expect(notes).toContain('## Unreleased');
    expect(notes).toContain('`show-filter` and `show-total`');
    expect(notes).not.toContain('## 0.1.3');
    expect(guidance).not.toContain('show-filter');
    expect(guidance).not.toContain('show-total');
  });

  it('tests the exact built dist before deployment or packaging', async () => {
    const buildWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');
    const releaseWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(buildWorkflow).toContain('playwright install --with-deps chromium firefox webkit');
    expect(buildWorkflow).toContain('npm run build:preview');
    expect(buildWorkflow).toContain('npm run lint');
    expect(buildWorkflow).toContain('npm run typecheck');
    expect(buildWorkflow).toContain('npm run check:jsviews');
    expect(buildWorkflow).toContain('npm run test:coverage');
    expect(buildWorkflow).toContain('npm run verify:dependencies');
    expect(buildWorkflow).toContain('node scripts/verify-release-gate.mjs');
    expect(buildWorkflow).toContain('npm run verify:dist -- --write --json');
    expect(buildWorkflow).toContain('npm run test:browser:dist');
    expect(buildWorkflow).toContain('node scripts/deploy.mjs --target ./build/deploy-preview');
    expect(buildWorkflow).toContain('node scripts/deploy.mjs --target ./build/stage11-host/custom/content');
    expect(buildWorkflow).toContain('npm run test:deployment:smoke');
    expect(buildWorkflow).toContain('npm run verify:dist -- --check --json');
    expect(releaseWorkflow).toContain('playwright install --with-deps chromium firefox webkit');
    expect(releaseWorkflow).toContain('npm run test:browser:dist');
    expect(releaseWorkflow).toContain('npm run test:deployment:smoke');
    expect(releaseWorkflow).toContain('npm run build:preview');
    expect(releaseWorkflow).toContain('npm run verify:dependencies');
    expect(releaseWorkflow).toContain('npm run verify:dist -- --check --json');
    const browserToPrepare = releaseWorkflow.slice(releaseWorkflow.indexOf('npm run test:browser:dist'), releaseWorkflow.indexOf('npm run release:prepare --'));
    expect(browserToPrepare).not.toContain('npm run build:preview');
    expect(releaseWorkflow).toContain('Download exact tested dist and inventory');
    expect(releaseWorkflow).toContain('Download exact dependency evidence');
    expect(releaseWorkflow).toContain('--notes-file RELEASE_NOTES.md');
    expect(releaseWorkflow).not.toContain('--generate-notes');
    expect(releaseWorkflow).toContain('release_args=()');
    expect(releaseWorkflow).toContain('core_version="${version%%+*}"');
    expect(releaseWorkflow).toContain('release_args+=(--prerelease)');
    expect(releaseWorkflow).toContain('"${release_args[@]}"');
    expect(releaseWorkflow).toContain('git ls-remote origin "refs/tags/${GITHUB_REF_NAME}" "refs/tags/${GITHUB_REF_NAME}^{}"');
    expect(releaseWorkflow).toContain('peeled_object');
    expect(releaseWorkflow).toContain('Remote origin tag ${GITHUB_REF_NAME} is absent or no longer resolves to ${GITHUB_SHA}');
    expect(releaseWorkflow.indexOf('git ls-remote origin')).toBeLessThan(releaseWorkflow.indexOf('gh release create'));
  });

  it('pins CI actions and separates quality artifacts from slower consumers', async () => {
    const buildWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');
    const releaseWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'security/ci-actions.json'), 'utf8')) as unknown;

    expect(validateCiActionsManifest(manifest, [buildWorkflow, releaseWorkflow]).actions).toHaveLength(6);
    for (const workflow of [buildWorkflow, releaseWorkflow]) expect(workflow).toContain('persist-credentials: false');

    expect(buildWorkflow).toContain("if: github.event_name == 'pull_request'");
    expect(buildWorkflow).toContain('pull-requests: read');
    expect(buildWorkflow).toContain('fail-on-severity: high');
    expect(buildWorkflow).toContain('needs: [quality, java-handoff]');
    expect(buildWorkflow).toContain('name: tested-dist');
    expect(buildWorkflow).toContain('if: always()');
    expect(buildWorkflow).toContain('if-no-files-found: warn');
    expect(releaseWorkflow).toContain('needs: [quality, java-handoff]');
    expect(releaseWorkflow).toContain('name: tested-dist');
    expect(releaseWorkflow).toContain('name: dependency-evidence');
    expect(releaseWorkflow).toContain('build/dependency-evidence');
    expect(releaseWorkflow).toContain('Download exact dependency evidence');
    const releaseJob = releaseWorkflow.slice(releaseWorkflow.indexOf('\n  release:'));
    expect(releaseJob).not.toContain('npm run build:preview');
    expect(releaseJob).not.toContain('npm run verify:dependencies');
    expect(releaseJob).not.toContain('npm run verify:dist -- --write');
  });

  it('rejects malformed, duplicate, missing, stale, mutable, and unapproved CI action trust data', async () => {
    const buildWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');
    const releaseWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'security/ci-actions.json'), 'utf8')) as CiActionManifest;
    const clone = () => structuredClone(manifest);

    expect(() => validateCiActionsManifest({ ...manifest, schemaVersion: 2 }, [buildWorkflow, releaseWorkflow])).toThrow(/schema/);
    expect(() => validateCiActionsManifest({ ...manifest, unexpected: true }, [buildWorkflow, releaseWorkflow])).toThrow(/unexpected fields/);
    expect(() => validateCiActionsManifest({ ...manifest, actions: [...manifest.actions, manifest.actions[0]] }, [buildWorkflow, releaseWorkflow])).toThrow(/Duplicate/);
    expect(() => validateCiActionsManifest({ ...manifest, actions: manifest.actions.slice(1) }, [buildWorkflow, releaseWorkflow])).toThrow(/Missing CI action approval/);
    const malformedEntry = clone();
    malformedEntry.actions[0] = { ...malformedEntry.actions[0], unexpected: true } as CiActionManifestEntry;
    expect(() => validateCiActionsManifest(malformedEntry, [buildWorkflow, releaseWorkflow])).toThrow(/entry has unexpected fields/);
    const invalidVersion = clone();
    invalidVersion.actions[0]!.version = '4.1.1';
    expect(() => validateCiActionsManifest(invalidVersion, [buildWorkflow, releaseWorkflow])).toThrow(/version is invalid/);
    const invalidSha = clone();
    invalidSha.actions[0]!.sha = 'not-a-sha';
    expect(() => validateCiActionsManifest(invalidSha, [buildWorkflow, releaseWorkflow])).toThrow(/SHA is invalid/);
    const duplicateSha = clone();
    duplicateSha.actions.splice(1, 0, { name: 'actions/cache', version: 'v1.0.0', sha: duplicateSha.actions[0]!.sha });
    expect(() => validateCiActionsManifest(duplicateSha, [buildWorkflow, releaseWorkflow])).toThrow(/Duplicate CI action SHA/);
    const stale = clone();
    stale.actions.splice(1, 0, { name: 'actions/cache', version: 'v1.0.0', sha: '1'.repeat(40) });
    expect(() => validateCiActionsManifest(stale, [buildWorkflow, releaseWorkflow])).toThrow(/Unused CI action approval/);

    const mutable = buildWorkflow.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@main');
    expect(() => validateCiActionsManifest(clone(), [mutable, releaseWorkflow])).toThrow(/Mutable or malformed/);
    const unapproved = buildWorkflow.replace(/actions\/checkout@[0-9a-f]{40}/, `third-party/checkout@${'2'.repeat(40)}`);
    expect(() => validateCiActionsManifest(clone(), [unapproved, releaseWorkflow])).toThrow(/Unapproved action owner/);
    const wrongVersion = buildWorkflow.replace(/actions\/checkout@([0-9a-f]{40}) # v\d+\.\d+\.\d+/, 'actions/checkout@$1 # v0.0.0');
    expect(() => validateCiActionsManifest(clone(), [wrongVersion, releaseWorkflow])).toThrow(/approval mismatch/);
  });

  it('keeps the Node.js/npm toolchain contract aligned across metadata, CI, and current guidance', async () => {
    const root = resolve(process.cwd());
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      engines: { node: string; npm: string };
      packageManager: string;
      devEngines: {
        runtime: { name: string; version: string; onFail: string };
        packageManager: { name: string; version: string; onFail: string };
      };
      devDependencies: Record<string, string>;
    };
    const packageLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')) as {
      packages: {
        '': { engines: { node: string; npm: string }; devDependencies: Record<string, string> };
        'node_modules/@types/node': { version: string };
      };
    };
    const nodeVersion = (await readFile(resolve(root, '.nvmrc'), 'utf8')).trim();
    const npmrc = (await readFile(resolve(root, '.npmrc'), 'utf8')).trim();
    const [buildWorkflow, releaseWorkflow, readme, handoff, notes] = await Promise.all([
      readFile(resolve(root, '.github/workflows/build.yml'), 'utf8'),
      readFile(resolve(root, '.github/workflows/release.yml'), 'utf8'),
      readFile(resolve(root, 'README.md'), 'utf8'),
      readFile(resolve(root, 'docs/release-handoff.md'), 'utf8'),
      readFile(resolve(root, 'RELEASE_NOTES.md'), 'utf8')
    ]);

    expect(nodeVersion).toBe('24.15.0');
    expect(packageJson.engines).toEqual({ node: '>=24.15 <25', npm: '>=11.12 <12' });
    expect(packageJson.packageManager).toBe('npm@11.12.1');
    expect(packageJson.devEngines).toEqual({
      runtime: { name: 'node', version: '24.15.0', onFail: 'error' },
      packageManager: { name: 'npm', version: '11.12.1', onFail: 'error' }
    });
    expect(packageJson.devDependencies['@types/node']).toBe('^24.13.3');
    expect(packageLock.packages[''].engines).toEqual(packageJson.engines);
    expect(packageLock.packages[''].devDependencies['@types/node']).toBe('^24.13.3');
    expect(packageLock.packages['node_modules/@types/node'].version).toBe('24.13.3');
    expect(npmrc).toBe('engine-strict=true');

    for (const workflow of [buildWorkflow, releaseWorkflow]) {
      expect(workflow).not.toContain('node-version: 20.12.0');
      expect(workflow.match(/node-version-file: \.nvmrc/g)?.length ?? 0).toBeGreaterThan(0);
      const npmCiSteps = workflow.match(/- name: Pin and verify Node\.js\/npm, then install dependencies[\s\S]*?\n {10}npm ci/g) ?? [];
      expect(npmCiSteps).toHaveLength(2);
      for (const step of npmCiSteps) {
        expect(step).toContain('working-directory: ${{ runner.temp }}');
        expect(step).toContain('npm install --global --prefix "$npm_prefix" "npm@${npm_version}"');
        expect(step).toContain('export PATH="${npm_prefix}/bin:${PATH}"');
        expect(step).toContain('"${npm_prefix}/bin" >> "$GITHUB_PATH"');
        expect(step).toContain("require('${GITHUB_WORKSPACE}/package.json').packageManager");
        expect(step).toContain('node --version');
        expect(step).toContain('npm --version');
        expect(step).toContain('test "$actual_node" = "v${expected_node}"');
        expect(step).toContain('test "$actual_npm" = "$npm_version"');
        expect(step.indexOf('export PATH=')).toBeLessThan(step.indexOf('actual_npm="$(npm --version)"'));
        expect(step.indexOf('actual_npm="$(npm --version)"')).toBeLessThan(step.indexOf('npm ci'));
      }
      expect(workflow.match(/npm ci/g)).toHaveLength(2);
      expect(workflow.match(/npm install --global --prefix/g)).toHaveLength(2);
    }
    expect(buildWorkflow).toContain('node-version-file: webui/.nvmrc');
    expect(releaseWorkflow).toContain('node-version-file: webui/.nvmrc');
    expect(buildWorkflow).toContain('cache-dependency-path: webui/package-lock.json');
    expect(releaseWorkflow).toContain('cache-dependency-path: webui/package-lock.json');
    expect(readme).toContain('Node.js `24.15.0`');
    expect(readme).toContain('npm `11.12.1`');
    expect(handoff).toContain('Node.js `24.15.0` and npm `11.12.1`');
    expect(notes).toContain('Node.js `24.15.0` and npm `11.12.1`');
    expect(notes).toContain('## 0.1.2');
    expect(notes.slice(notes.indexOf('## 0.1.2'))).toContain('Node.js `>=20.12` in the Node 20 release line');
  });

  it('defines bounded monthly Dependabot groups', async () => {
    const dependabot = await readFile(resolve(process.cwd(), '.github/dependabot.yml'), 'utf8');
    const policy = dependabot.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
    const block = (source: string, start: RegExp, end: RegExp) => {
      const startIndex = source.search(start);
      if (startIndex < 0) throw new Error('Dependabot block start is missing');
      const endIndex = source.slice(startIndex + 1).search(end);
      if (endIndex < 0) throw new Error('Dependabot block end is missing');
      return source.slice(startIndex, startIndex + 1 + endIndex);
    };
    const npm = block(policy, /^\s{2}- package-ecosystem: npm/m, /^\s{2}- package-ecosystem: /m);
    const actionsStart = policy.search(/^\s{2}- package-ecosystem: github-actions/m);
    if (actionsStart < 0) throw new Error('GitHub Actions Dependabot block is missing');
    const actions = policy.slice(actionsStart).trimEnd();
    const allow = block(npm, /^\s{4}allow:/m, /^\s{4}groups:/m);
    const production = block(npm, /^\s{6}npm-production:/m, /^\s{6}npm-development:/m);
    const developmentStart = npm.search(/^\s{6}npm-development:/m);
    if (developmentStart < 0) throw new Error('npm development group is missing');
    const development = npm.slice(developmentStart).trimEnd();

    expect(policy.match(/^version: 2$/gm)).toHaveLength(1);
    expect(policy.match(/^\s{2}- package-ecosystem:/gm)).toHaveLength(2);
    expect(policy.match(/^\s{6}interval: monthly$/gm)).toHaveLength(2);
    expect(npm.trimEnd()).toBe([
      '  - package-ecosystem: npm',
      '    directory: /',
      '    schedule:',
      '      interval: monthly',
      '    open-pull-requests-limit: 5',
      '    allow:',
      "      - dependency-name: '*'",
      '        update-types:',
      '          - version-update:semver-minor',
      '          - version-update:semver-patch',
      '    groups:',
      '      npm-production:',
      '        applies-to: version-updates',
      '        dependency-type: production',
      '        update-types:',
      '          - minor',
      '          - patch',
      '        exclude-patterns:',
      '          - jquery',
      '          - jsviews',
      '      npm-development:',
      '        applies-to: version-updates',
      '        dependency-type: development',
      '        update-types:',
      '          - minor',
      '          - patch',
      '        exclude-patterns:',
      "          - '@lezer/markdown'"
    ].join('\n'));
    expect(allow.trim()).toBe([
      'allow:',
      "      - dependency-name: '*'",
      '        update-types:',
      '          - version-update:semver-minor',
      '          - version-update:semver-patch'
    ].join('\n'));
    expect(production.trim()).toBe([
      'npm-production:',
      '        applies-to: version-updates',
      '        dependency-type: production',
      '        update-types:',
      '          - minor',
      '          - patch',
      '        exclude-patterns:',
      '          - jquery',
      '          - jsviews'
    ].join('\n'));
    expect(development.trim()).toBe([
      'npm-development:',
      '        applies-to: version-updates',
      '        dependency-type: development',
      '        update-types:',
      '          - minor',
      '          - patch',
      '        exclude-patterns:',
      "          - '@lezer/markdown'"
    ].join('\n'));
    expect(actions).toBe([
      '  - package-ecosystem: github-actions',
      '    directory: /',
      '    schedule:',
      '      interval: monthly',
      '    open-pull-requests-limit: 3',
      '    groups:',
      '      github-actions:',
      '        applies-to: version-updates',
      '        patterns:',
      "          - '*'"
    ].join('\n'));
    expect(npm).toContain('open-pull-requests-limit: 5');
    expect(npm).not.toContain('semver-major');
    for (const issue of ['#7', '#8', '#9', '#10', '#11']) expect(dependabot).toContain(issue);
    expect(policy).not.toMatch(/^\s*ignore:/m);
  });

  it('pins the Stage 11 production handoff boundary and evidence', async () => {
    const handoff = await readFile(resolve(process.cwd(), 'docs/release-handoff.md'), 'utf8');
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
    const notes = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8');
    const architecture = await readFile(resolve(process.cwd(), 'docs/architecture.md'), 'utf8');

    expect(handoff).toContain('There is no production installer in this repository');
    expect(readme).not.toContain('Production deployment defaults');
    expect(readme).not.toContain('npm run deploy\n');
    expect(handoff).toContain('preserve all V1 files by default');
    expect(handoff).toContain('index.htm');
    expect(handoff).toContain('requires recorded approval');
    expect(handoff).toContain('hashed artifact inventory');
    expect(handoff).toContain('npm run verify:java-handoff');
    expect(handoff).toContain('expected-branch dev');
    expect(handoff).toContain('expected-branch master');
    expect(handoff).toContain('SHA-256 checksum');
    expect(handoff).toContain('provenance/attestation');
    expect(handoff).toContain('approval identities, timestamps');
    expect(handoff).toContain('reinstall the previous verified Java artifact');
    expect(handoff).toContain('Do not manually delete random `v2` chunks');
    expect(notes).toContain('## 0.1.2');
    expect(notes).toContain('future integration step');
    expect(notes).toContain('production handoff runbook');
    expect(architecture).toContain('no production installer');
    expect(architecture).toContain('preserve V1 by default');
  });

  it('pins Stage 11 package commands, evidence, smoke, and release security gates', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const buildWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');
    const releaseWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(packageJson.scripts.deploy).toBeUndefined();
    expect(packageJson.scripts['deploy:catalog']).toBeUndefined();
    expect(packageJson.scripts['deploy:preview']).toContain('deploy-preview');
    expect(packageJson.scripts['deploy:catalog:preview']).toContain('deploy-catalog-preview');
    expect(packageJson.scripts['deploy:test']).toContain('--java-checkout ../nodel');
    expect(packageJson.scripts['deploy:test']).toContain('--expected-java-branch dev');
    expect(packageJson.scripts['deploy:test']).toContain('./build/stage11-host/custom/content');
    expect(packageJson.scripts['deploy:test']).not.toContain('/opt');
    expect(packageJson.scripts['deploy:catalog:test']).toContain('./build/stage11-host/nodes/Nodel Components Catalog/content');
    expect(packageJson.scripts['deploy:catalog:test']).toContain('--support-root');
    expect(packageJson.scripts['deploy:catalog:preview']).toContain('--support-root');
    expect(packageJson.scripts['verify:java-handoff']).toContain('verify-java-handoff.mjs');
    expect(packageJson.scripts['test:browser']).toBe('npm run build:preview && playwright test');
    expect(packageJson.scripts['test:browser:dist']).toBe('playwright test');
    expect(packageJson.scripts['test:deployment:smoke']).toBe('node ./scripts/run-deployment-smoke.mjs');
    expect(packageJson.scripts['verify:dist']).toBe('node ./scripts/verify-deployment-inventory.mjs');
    expect(packageJson.scripts['release:prepare']).toBe('node ./scripts/prepare-release.mjs');
    expect(packageJson.scripts['release:build']).toBe('npm run verify:dependencies && npm run build && npm run release:prepare');

    for (const workflow of [buildWorkflow, releaseWorkflow]) {
      expect(workflow).toContain('java-handoff');
      expect(workflow).toContain('java-branch: [dev, master]');
      expect(workflow).toContain('--expected-branch "${{ matrix.java-branch }}"');
      expect(workflow).toContain('--output "build/java-handoff/${{ matrix.java-branch }}.json"');
      expect(workflow).toContain('Upload Java handoff report');
      expect(workflow).toContain('persist-credentials: false');
      expect(workflow).toContain('manifest and collision compatibility');
      expect(workflow).not.toContain('/opt');
    }
    expect(buildWorkflow).toContain('cache-dependency-path: webui/package-lock.json');
    expect(buildWorkflow).toContain('needs: [quality, java-handoff]');
    expect(releaseWorkflow).toContain('needs: [quality, java-handoff]');
    expect(releaseWorkflow).toContain('environment: production-release');
    expect(releaseWorkflow).toContain('contents: read');
    expect(releaseWorkflow).toContain('contents: write');
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('attestations: write');
    expect(releaseWorkflow).toContain('git fetch --no-tags origin main');
    expect(releaseWorkflow).toContain('Verify tag commit is reachable from origin/main');
    expect(releaseWorkflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(releaseWorkflow).toContain('Download Java dev handoff report');
    expect(releaseWorkflow).toContain('Download Java master handoff report');
    expect(releaseWorkflow).toContain('npm run release:prepare --');
    expect(releaseWorkflow).toContain('--commit "$GITHUB_SHA"');
    expect(releaseWorkflow).toContain('--branch main');
    expect(releaseWorkflow).toContain('--tag "$GITHUB_REF_NAME"');
    expect(releaseWorkflow).toContain('--repository "${{ github.repository }}"');
    expect(releaseWorkflow).toContain('--source-date-epoch');
    expect(releaseWorkflow).toContain('--dist-inventory build/dist-inventory.json');
    expect(releaseWorkflow).toContain('--java-dev-report build/java-handoff/dev.json');
    expect(releaseWorkflow).toContain('--java-master-report build/java-handoff/master.json');
    expect(releaseWorkflow).toContain('--ci-run-url "https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"');
    expect(releaseWorkflow).toContain('--approval-environment production-release');
    expect(releaseWorkflow).toContain('node scripts/verify-release-archive.mjs --target "build/${archive}" --json');
    expect(releaseWorkflow.indexOf('verify-release-archive.mjs')).toBeLessThan(releaseWorkflow.indexOf('sha256sum'));
    const deploymentSmoke = await readFile(resolve(process.cwd(), 'scripts/run-deployment-smoke.mjs'), 'utf8');
    const deploymentSpec = await readFile(resolve(process.cwd(), 'e2e/deployment/deployment-smoke.spec.ts'), 'utf8');
    expect(deploymentSmoke).toContain('build/deploy-preview');
    expect(deploymentSmoke).toContain('build/stage11-host/custom/content');
    expect(deploymentSmoke).toContain('assertProjectBuildTarget');
    expect(deploymentSmoke).toContain('valid ${markerName} marker');
    expect(deploymentSpec).toContain("const pages = ['index.htm', 'nodes.html', 'nodel.html', 'toolkit.html', 'components.html']");
    expect(deploymentSpec).toContain('data-nodel-runtime="memory"');
    expect(deploymentSpec).toContain('offline-mode="overlay"');
  });

  it('documents schema 5 dependency evidence and executable, non-duplicated runbook commands', async () => {
    const handoff = await readFile(resolve(process.cwd(), 'docs/release-handoff.md'), 'utf8');
    const architecture = await readFile(resolve(process.cwd(), 'docs/architecture.md'), 'utf8');
    const notes = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8');

    expect(handoff.indexOf('npm run verify:java-handoff')).toBeLessThan(handoff.indexOf('node scripts/deploy.mjs --java-checkout ../nodel-dev'));
    expect(handoff).not.toContain('npm run deploy:test --');
    expect(handoff).toContain('schema 5');
    expect(handoff).toContain('v2/nodel-components.json');
    expect(handoff).toContain('dist-inventory');
    expect(handoff).toContain('canonical\n`dist` inventory SHA-256 digest');
    expect(handoff).toContain('java-handoff/dev.json');
    expect(handoff).toContain('exact V1\nhashed file inventory');
    expect(handoff).toContain('best-effort recoverable two-rename');
    expect(handoff).not.toContain('atomic staged replacement');
    expect(handoff).toContain('does not claim\nbit-for-bit reproducible ZIP bytes');
    expect(handoff).toContain('does not claim protection from a malicious same-user process');
    expect(handoff).toContain('between final filesystem syscall boundaries');
    expect(handoff).toContain('Approval identities and timestamps remain evidence');
    expect(handoff).toContain('## Local Nonpublishable Rehearsal');
    expect(handoff).toContain('--java-checkout ../nodel-dev --expected-branch dev --output build/java-handoff/dev.json');
    expect(handoff).toContain('--java-checkout ../nodel-master --expected-branch master --output build/java-handoff/master.json');
    expect(handoff).toContain('--java-checkout ../nodel-dev --expected-java-branch dev --target build/stage11-host/custom/content');
    expect(handoff).toContain('--dist-inventory build/dist-inventory.json --java-dev-report build/java-handoff/dev.json --java-master-report build/java-handoff/master.json');
    expect(handoff).toContain('intentionally nonpublishable');
    expect(handoff).toContain('production-release` environment provenance');
    expect(architecture).toContain('schema is version 5');
    expect(architecture).toContain('verify:dist');
    expect(architecture).toContain('no `--support-subdir` deployment option');
    expect(architecture).toContain('test:deployment:smoke');
    expect(notes).toContain('best-effort recoverable two-rename');
    expect(notes).toContain('schema 5');
    expect(notes).toContain('v2/nodel-components.json');
    expect(await readFile(resolve(process.cwd(), 'README.md'), 'utf8')).toContain('schema 5 `release.json`');
  });
});
