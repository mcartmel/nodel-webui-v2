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

  it('gates branch and tagged release workflows with all browser engines and curated notes', async () => {
    const buildWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/build.yml'), 'utf8');
    const releaseWorkflow = await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(buildWorkflow).toContain('playwright install --with-deps chromium firefox webkit');
    expect(buildWorkflow).toContain('npm run test:browser');
    expect(releaseWorkflow).toContain('playwright install --with-deps chromium firefox webkit');
    expect(releaseWorkflow).toContain('npm run test:browser');
    expect(releaseWorkflow).toContain('--notes-file RELEASE_NOTES.md');
    expect(releaseWorkflow).not.toContain('--generate-notes');
  });
});
