import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
    const pinned = new Map([
      ['actions/checkout', '11bd71901bbe5b1630ceea73d27597364c9af683'],
      ['actions/setup-node', '49933ea5288caeca8642d1e84afbd3f7d6820020'],
      ['actions/upload-artifact', 'ea165f8d65b6e75b540449e92b4886f43607fa02'],
      ['actions/download-artifact', 'd3f86a106a0bac45b974a628896c90dbdf5c8093'],
      ['actions/attest-build-provenance', 'e8998f949152b193b063cb0ec769d69d929409be'],
      ['actions/dependency-review-action', '3c4e3dcb1aa7874d2c16be7d79418e9b7efd6261']
    ]);

    for (const workflow of [buildWorkflow, releaseWorkflow]) {
      for (const line of workflow.split('\n').filter((candidate) => candidate.includes('uses:'))) {
        const match = line.match(/uses:\s+([^\s#]+)/);
        if (!match) throw new Error(`Malformed uses line: ${line}`);
        const uses = match[1];
        if (!uses) throw new Error(`Empty uses value: ${line}`);
        const [action, sha] = uses.split('@');
        expect(action).toMatch(/^actions\/[a-z0-9-]+$/);
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(line).toContain('# v');
        if (action && pinned.has(action)) {
          expect(sha, `${action} must be immutable`).toBe(pinned.get(action));
        }
      }
      expect(workflow).not.toMatch(/uses:\s+[^\s#]+@(v|main|master|latest)(?:\s|$)/m);
      expect(workflow).toContain('persist-credentials: false');
    }

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

  it('defines bounded monthly Dependabot groups', async () => {
    const dependabot = await readFile(resolve(process.cwd(), '.github/dependabot.yml'), 'utf8');
    expect(dependabot).toContain('version: 2');
    expect(dependabot).toContain('package-ecosystem: npm');
    expect(dependabot).toContain('package-ecosystem: github-actions');
    expect(dependabot.match(/interval: monthly/g)).toHaveLength(2);
    expect(dependabot).toContain('npm-production:');
    expect(dependabot).toContain('npm-development:');
    expect(dependabot).toContain('dependency-type: production');
    expect(dependabot).toContain('dependency-type: development');
    expect(dependabot).toContain('github-actions:');
    expect(dependabot).toContain('open-pull-requests-limit: 5');
    expect(dependabot).toContain('open-pull-requests-limit: 3');
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
