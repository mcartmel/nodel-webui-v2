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

  it('tests the exact built dist before deployment or packaging', async () => {
    const buildWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');
    const releaseWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(buildWorkflow).toContain('playwright install --with-deps chromium firefox webkit');
    expect(buildWorkflow).toContain('npm run build');
    expect(buildWorkflow).toContain('npm run verify:dist -- --write --json');
    expect(buildWorkflow).toContain('npm run test:browser:dist');
    expect(buildWorkflow).toContain('node scripts/deploy.mjs --target ./build/deploy-preview');
    expect(buildWorkflow).toContain('node scripts/deploy.mjs --target ./build/stage11-host/custom/content');
    expect(buildWorkflow).toContain('npm run test:deployment:smoke');
    expect(buildWorkflow).toContain('npm run verify:dist -- --check --json');
    expect(releaseWorkflow).toContain('playwright install --with-deps chromium firefox webkit');
    expect(releaseWorkflow).toContain('npm run test:browser:dist');
    expect(releaseWorkflow).toContain('npm run test:deployment:smoke');
    expect(releaseWorkflow).toContain('npm run verify:dist -- --write --json');
    expect(releaseWorkflow).toContain('npm run verify:dist -- --check --json');
    const browserToPrepare = releaseWorkflow.slice(releaseWorkflow.indexOf('npm run test:browser:dist'), releaseWorkflow.indexOf('npm run release:prepare --'));
    expect(browserToPrepare).not.toContain('npm run build');
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
    expect(packageJson.scripts['release:build']).toBe('npm run build && npm run release:prepare');

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
    expect(buildWorkflow).toContain('needs: java-handoff');
    expect(releaseWorkflow).toContain('needs: java-handoff');
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

  it('documents schema 3 package evidence and executable, non-duplicated runbook commands', async () => {
    const handoff = await readFile(resolve(process.cwd(), 'docs/release-handoff.md'), 'utf8');
    const architecture = await readFile(resolve(process.cwd(), 'docs/architecture.md'), 'utf8');
    const notes = await readFile(resolve(process.cwd(), 'RELEASE_NOTES.md'), 'utf8');

    expect(handoff.indexOf('npm run verify:java-handoff')).toBeLessThan(handoff.indexOf('node scripts/deploy.mjs --java-checkout ../nodel-dev'));
    expect(handoff).not.toContain('npm run deploy:test --');
    expect(handoff).toContain('schema 3');
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
    expect(architecture).toContain('schema is version 3');
    expect(architecture).toContain('verify:dist');
    expect(architecture).toContain('no `--support-subdir` deployment option');
    expect(architecture).toContain('test:deployment:smoke');
    expect(notes).toContain('best-effort recoverable two-rename');
    expect(notes).toContain('schema 3');
  });
});
