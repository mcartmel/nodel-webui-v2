import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flush } from './helpers';
import '../src/components/nodel-app';
import '../src/components/nodel-page';
import {
  BACKGROUND_PATTERN_IDS,
  normalizeBackgroundColor,
  normalizeBackgroundPosition,
  patternAsset,
  patternSize,
  renderBackground,
  resolveBackgroundSettings,
} from '../src/backgrounds/backgrounds';

describe('background model', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/nodes/Demo/pages/control.html');
  });

  it('shares all nine pattern IDs and designed dimensions', () => {
    expect(BACKGROUND_PATTERN_IDS).toHaveLength(9);
    for (const pattern of BACKGROUND_PATTERN_IDS) {
      expect(patternAsset(pattern)).toBe(`var(--nodel-background-pattern-${pattern})`);
      expect(patternSize(pattern, 100)).toMatch(/px \d+px$/);
    }
  });

  it('keeps the intentionally large contour tile and fine repeat dimensions', () => {
    expect(patternSize('concentric-waves', 100)).toBe('360px 240px');
    expect(patternSize('hexagonal-mesh', 100)).toBe('60px 52px');
    expect(patternSize('carbon-fibre', 100)).toBe('48px 48px');
    expect(patternSize('carbon-fibre', 400)).toBe('192px 192px');
    expect(patternSize('checkerplate', 100)).toBe('192px 192px');
    expect(patternSize('brushed-metal', 100)).toBe('768px 192px');
    expect(patternSize('woven-fabric', 100)).toBe('192px 192px');
    expect(patternSize('diagonal-grain', 100)).toBe('32px 32px');
    expect(patternSize('ripples', 100)).toBe('240px 96px');
  });

  it('keeps source SVG dimensions aligned with the catalog dimensions', () => {
    const dimensions = [
      ['carbon-fibre', 48, 48], ['checkerplate', 192, 192], ['brushed-metal', 768, 192],
      ['woven-fabric', 192, 192], ['diagonal-grain', 32, 32], ['dotted-grid', 48, 48],
      ['hexagonal-mesh', 60, 52], ['ripples', 240, 96], ['concentric-waves', 360, 240]
    ] as const;
    for (const [pattern, width, height] of dimensions) {
      const source = readFileSync(resolve(process.cwd(), `src/assets/backgrounds/${pattern}.svg`), 'utf8');
      expect(source.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/)?.slice(1)).toEqual([String(width), String(height)]);
    }
  });

  it('normalizes the explicit RGB grammar without accepting alpha or expressions', () => {
    expect(normalizeBackgroundColor('rgb(1, 2.5, 255)')).toBe('rgb(1 2.5 255)');
    expect(normalizeBackgroundColor('rgb(1 2 3)')).toBe('rgb(1 2 3)');
    expect(normalizeBackgroundColor('#abc')).toBe('rgb(170 187 204)');
    expect(normalizeBackgroundColor('#102030')).toBe('rgb(16 32 48)');
    expect(normalizeBackgroundColor('theme')).toBe('theme');
    for (const value of ['rgb(1, 2)', 'rgb(1 2 3 / .5)', 'rgb(1, 2, 300)', 'rgb(var(--x))', '']) {
      expect(normalizeBackgroundColor(value), value).toBeNull();
    }
  });

  it('normalizes positions and rejects malformed or out-of-range percentages', () => {
    expect(normalizeBackgroundPosition('center')).toBe('center');
    expect(normalizeBackgroundPosition('top left')).toBe('top left');
    expect(normalizeBackgroundPosition('50% 30%')).toBe('50% 30%');
    expect(normalizeBackgroundPosition('center left')).toBeNull();
    expect(normalizeBackgroundPosition('101% 0%')).toBeNull();
    expect(normalizeBackgroundPosition('50%')).toBeNull();
    expect(normalizeBackgroundPosition('center 20%')).toBeNull();
  });

  it('clamps signed numeric adjustment values at both boundaries', () => {
    const app = document.createElement('nodel-app');
    app.setAttribute('background-pattern-strength', '-10');
    app.setAttribute('background-brightness', '-10');
    app.setAttribute('background-pattern-scale', '-10');
    const low = resolveBackgroundSettings(app).settings;
    expect(low.patternStrength).toBe(0);
    expect(low.brightness).toBe(0);
    expect(low.patternScale).toBe(25);

    app.setAttribute('background-pattern-strength', '+100');
    app.setAttribute('background-brightness', '+200');
    app.setAttribute('background-pattern-scale', '+400');
    const high = resolveBackgroundSettings(app).settings;
    expect(high.patternStrength).toBe(100);
    expect(high.brightness).toBe(200);
    expect(high.patternScale).toBe(400);
  });

  it('resolves app, group, and leaf levels independently with safe absolute images', () => {
    const app = document.createElement('nodel-app');
    app.setAttribute('background-color', '#123456');
    app.setAttribute('background-image', './base.png');
    const group = document.createElement('nodel-page');
    group.setAttribute('background-brightness', '65');
    const leaf = document.createElement('nodel-page');
    leaf.setAttribute('background-pattern', 'ripples');
    leaf.setAttribute('background-image', 'javascript:alert(1)');
    app.append(group);
    group.append(leaf);

    const resolved = resolveBackgroundSettings(app, [group, leaf]);
    expect(resolved.customized).toBe(true);
    expect(resolved.settings.color).toBe('rgb(18 52 86)');
    expect(resolved.settings.brightness).toBe(65);
    expect(resolved.settings.pattern).toBe('ripples');
    expect(resolved.settings.image).toBeNull();
  });

  it('does not activate rendering for invalid non-image values', () => {
    const app = document.createElement('nodel-app');
    app.setAttribute('background-pattern', 'bogus');
    const page = document.createElement('nodel-page');
    page.setAttribute('background-brightness', 'not-a-number');
    app.append(page);
    expect(resolveBackgroundSettings(app, [page])).toMatchObject({ customized: false });
  });

  it('keeps rejected non-empty images as intentional clears', () => {
    const app = document.createElement('nodel-app');
    app.setAttribute('background-image', 'javascript:alert(1)');
    const resolved = resolveBackgroundSettings(app);
    expect(resolved.customized).toBe(true);
    expect(resolved.settings.image).toBeNull();
  });

  it('renders accepted blob and constrained data image URLs as single CSS values', () => {
    const app = document.createElement('div');
    for (const image of ['blob:http://localhost:3000/image-id', 'data:image/png;base64,iVBORw0KGgo=']) {
      app.setAttribute('background-image', image);
      const resolved = resolveBackgroundSettings(app);
      renderBackground(app, resolved);
      expect(resolved.settings.image).toBe(image);
      expect(app.style.getPropertyValue('--nodel-background-image')).toBe(`url("${image}")`);
    }
  });

  it('activates intentional valid resets and preserves valid inherited values', () => {
    const app = document.createElement('nodel-app');
    app.setAttribute('background-color', '#123456');
    app.setAttribute('background-image', './base.png');
    const page = document.createElement('nodel-page');
    page.setAttribute('background-color', 'theme');
    page.setAttribute('background-image', 'none');
    app.append(page);
    const resolved = resolveBackgroundSettings(app, [page]);
    expect(resolved.customized).toBe(true);
    expect(resolved.settings.color).toBe('theme');
    expect(resolved.settings.image).toBeNull();

    page.removeAttribute('background-color');
    page.removeAttribute('background-image');
    expect(resolveBackgroundSettings(app, [page]).settings).toMatchObject({
      color: 'rgb(18 52 86)',
      image: 'http://localhost:3000/nodes/Demo/pages/base.png'
    });
  });

  it('does not resolve pages owned by a nested app', () => {
    const app = document.createElement('nodel-app');
    const nested = document.createElement('nodel-app');
    const page = document.createElement('nodel-page');
    page.setAttribute('background-pattern', 'ripples');
    nested.append(page);
    app.append(nested);
    expect(resolveBackgroundSettings(app, [page]).settings.pattern).toBe('none');
  });

  it('escapes untrusted URL strings at the actual render sink', () => {
    const app = document.createElement('div');
    const resolved = resolveBackgroundSettings(app);
    resolved.settings.image = 'https://example.test/a"\\\n.png';
    renderBackground(app, { ...resolved, customized: true });
    expect(app.style.getPropertyValue('--nodel-background-image')).toBe('url("https://example.test/a%22%5C%0A.png")');

    resolved.settings.image = 'https://example.test/already%20encoded.png';
    renderBackground(app, { ...resolved, customized: true });
    expect(app.style.getPropertyValue('--nodel-background-image')).toContain('already%20encoded.png');
  });
});

describe('app-owned background rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/');
  });

  it('keeps the default app uncustomized and updates only active page levels', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Plain">Plain</nodel-page>
        <nodel-page title="Textured" background-pattern="dotted-grid" background-pattern-strength="0"></nodel-page>
      </nodel-app>`;
    const app = document.querySelector('nodel-app') as HTMLElement;
    await flush();
    expect(app.dataset.backgroundActive).toBe('false');

    const textured = document.querySelector('nodel-page[title="Textured"]') as HTMLElement;
    window.history.replaceState(undefined, '', '/#Textured');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(app.dataset.backgroundActive).toBe('true');
    expect(app.style.getPropertyValue('--nodel-background-pattern-opacity')).toBe('0');

    textured.removeAttribute('background-pattern');
    textured.removeAttribute('background-pattern-strength');
    await flush();
    expect(app.dataset.backgroundActive).toBe('false');
  });

  it('cleans the decorative gate when disconnected', async () => {
    document.body.innerHTML = '<nodel-app background-pattern="ripples"><nodel-page title="Home"></nodel-page></nodel-app>';
    const app = document.querySelector('nodel-app') as HTMLElement;
    await flush();
    expect(app.dataset.backgroundActive).toBe('true');
    app.remove();
    expect(app.dataset.backgroundActive).toBe('false');
    expect(app.style.cssText).toBe('');
    renderBackground(app, resolveBackgroundSettings(app));
  });

  it('applies the same attribute from app, group, and leaf in precedence order', async () => {
    document.body.innerHTML = `
      <nodel-app background-pattern="carbon-fibre">
        <nodel-page title="Group" background-pattern="checkerplate">
          <nodel-page title="Leaf" background-pattern="ripples"></nodel-page>
        </nodel-page>
      </nodel-app>`;
    const app = document.querySelector('nodel-app') as HTMLElement;
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('ripples');
    const leaf = document.querySelector('nodel-page[title="Leaf"]') as HTMLElement;
    leaf.removeAttribute('background-pattern');
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('checkerplate');
    const group = document.querySelector('nodel-page[title="Group"]') as HTMLElement;
    group.removeAttribute('background-pattern');
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('carbon-fibre');
  });

  it('updates active pages without navigating and ignores inactive page edits', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page nav-id="First" title="First" background-pattern="ripples"></nodel-page>
        <nodel-page nav-id="Second" title="Second"></nodel-page>
      </nodel-app>`;
    const app = document.querySelector('nodel-app') as HTMLElement;
    await flush();
    let navigationChanges = 0;
    app.addEventListener('nodel-navigation-change', () => navigationChanges += 1);
    const first = app.querySelector('[nav-id="First"]') as HTMLElement;
    const second = app.querySelector('[nav-id="Second"]') as HTMLElement;
    second.setAttribute('background-pattern', 'checkerplate');
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('ripples');
    expect(navigationChanges).toBe(0);
    first.setAttribute('background-pattern', 'dotted-grid');
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('dotted-grid');
    expect(navigationChanges).toBe(0);
  });

  it('rediscovers replacement and removal while preserving app defaults', async () => {
    document.body.innerHTML = '<nodel-app background-pattern="carbon-fibre"><nodel-page nav-id="First" title="First" background-pattern="ripples"></nodel-page></nodel-app>';
    const app = document.querySelector('nodel-app') as HTMLElement;
    await flush();
    const original = app.querySelector('nodel-page') as HTMLElement;
    original.remove();
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('carbon-fibre');
    const replacement = document.createElement('nodel-page');
    replacement.setAttribute('nav-id', 'Replacement');
    replacement.setAttribute('title', 'Replacement');
    replacement.setAttribute('background-pattern', 'hexagonal-mesh');
    app.append(replacement);
    await flush();
    expect(app.style.getPropertyValue('--nodel-background-pattern')).toContain('hexagonal-mesh');
  });

  it('isolates nested app mutations and reconnects its own backdrop cleanly', async () => {
    document.body.innerHTML = `
      <nodel-app background-pattern="carbon-fibre">
        <nodel-page title="Outer"></nodel-page>
        <nodel-app background-pattern="checkerplate"><nodel-page title="Inner"></nodel-page></nodel-app>
      </nodel-app>`;
    const outer = document.querySelector('nodel-app') as HTMLElement;
    const inner = outer.querySelector('nodel-app') as HTMLElement;
    await flush();
    let navigationChanges = 0;
    outer.addEventListener('nodel-navigation-change', () => navigationChanges += 1);
    inner.append(document.createElement('nodel-page'));
    await flush();
    expect(navigationChanges).toBe(0);
    expect(outer.style.getPropertyValue('--nodel-background-pattern')).toContain('carbon-fibre');
    outer.remove();
    expect(outer.dataset.backgroundActive).toBe('false');
    document.body.append(outer);
    await flush();
    expect(outer.dataset.backgroundActive).toBe('true');
    expect(outer.style.getPropertyValue('--nodel-background-pattern')).toContain('carbon-fibre');
  });
});
