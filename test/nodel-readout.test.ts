import { readStyleSource } from './style-source';

const activityMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: any) => void>,
  dispose: vi.fn()
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: activityMock.dispose };
  })
}));

import '../src/components/nodel-readout';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 }
    });
  }
}

describe('nodel-readout', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('uses label for accessibility and renders value with variant and tone metadata', async () => {
    document.body.innerHTML = '<nodel-readout label="Source" value="HDMI 1" variant="primary" tone="soft"></nodel-readout>';
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const readout = document.querySelector('nodel-readout') as HTMLElement;
    expect(readout.dataset.variant).toBe('primary');
    expect(readout.dataset.tone).toBe('soft');
    expect(readout.querySelector('.nodel-readout-label')).toBeNull();
    expect(readout.getAttribute('aria-label')).toBe('Source: HDMI 1');
    expect(readout.querySelector('.nodel-readout-value')?.textContent).toBe('HDMI 1');
  });

  it('formats numeric, percent, db, boolean, and duration values', async () => {
    document.body.innerHTML = `
      <nodel-readout type="number" value="22.54" precision="1" suffix="C"></nodel-readout>
      <nodel-readout type="percent" value="72"></nodel-readout>
      <nodel-readout type="db" value="3"></nodel-readout>
      <nodel-readout type="boolean" value="on"></nodel-readout>
      <nodel-readout type="duration" value="3661"></nodel-readout>
    `;
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const values = Array.from(document.querySelectorAll('.nodel-readout-value')).map((node) => node.textContent);
    expect(values).toEqual(['22.5C', '72%', '+3 dB', 'On', '1:01:01']);
  });

  it('derives ring fraction and accessible meter metadata', async () => {
    document.body.innerHTML = '<nodel-readout label="Brightness" type="percent" visual="ring" value="75"></nodel-readout>';
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const readout = document.querySelector('nodel-readout') as HTMLElement;
    expect(readout.dataset.visual).toBe('ring');
    expect(readout.style.getPropertyValue('--nodel-readout-fraction')).toBe('0.75');
    expect(readout.getAttribute('role')).toBe('meter');
    expect(readout.getAttribute('aria-label')).toBe('Brightness: 75%');
    expect(readout.getAttribute('aria-valuenow')).toBe('75');
  });

  it('keeps compact rings selected by default and renders the edge SVG only when opted in', async () => {
    document.body.innerHTML = '<nodel-readout label="Brightness" type="percent" visual="ring" value="75"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    const svg = readout.querySelector('.nodel-readout-edge-visual') as unknown as HTMLElement;
    expect(readout.dataset.ringLayout).toBe('compact');
    expect(readout.dataset.notchPosition).toBeUndefined();
    expect(readout.dataset.notchDepth).toBeUndefined();
    expect(svg.hidden).toBe(true);
    expect(readout.querySelector('.nodel-readout-visual')).not.toBeNull();

    readout.setAttribute('ring-layout', 'edge');
    await Promise.resolve();
    expect(svg.hidden).toBe(false);
    expect(readout.dataset.notchPosition).toBe('bottom');
    expect(readout.dataset.notchDepth).toBe('15.4167%');
    expect(svg.getAttribute('viewBox')).toBe('0 0 240 240');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(readout.querySelector('.nodel-readout-edge-track')).toBeTruthy();
    expect(readout.querySelector('.nodel-readout-edge-progress')).toBeTruthy();

    readout.setAttribute('ring-layout', 'compact');
    await Promise.resolve();
    expect(readout.dataset.notchPosition).toBeUndefined();
    expect(readout.dataset.notchDepth).toBeUndefined();

    readout.setAttribute('visual', 'bar');
    await Promise.resolve();
    expect(readout.dataset.notchPosition).toBeUndefined();
    expect(readout.dataset.notchDepth).toBeUndefined();
  });

  it('normalizes edge geometry attributes and rotations without rotating text', async () => {
    document.body.innerHTML = '<nodel-readout label="Level" type="percent" visual="ring" ring-layout="edge" notch-position="right" notch-depth="75%" value="50"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    const group = readout.querySelector('svg > g')!;
    const path = readout.querySelector('.nodel-readout-edge-track')!;
    expect(readout.dataset.notchPosition).toBe('right');
    expect(readout.dataset.notchDepth).toBe('50%');
    expect(group.getAttribute('transform')).toBe('rotate(270 120 120)');
    expect(path.getAttribute('d')).not.toMatch(/NaN/);
    expect(path.getAttribute('d')).toContain('120');

    readout.setAttribute('notch-position', 'invalid');
    readout.setAttribute('notch-depth', 'not-a-percent');
    await Promise.resolve();
    expect(readout.dataset.notchPosition).toBe('bottom');
    expect(readout.dataset.notchDepth).toBe('15.4167%');
    expect(group.getAttribute('transform')).toBe('rotate(0 120 120)');
    expect(path.getAttribute('d')).toContain('202.999');
    expect(path.getAttribute('d')).toContain('A 115 115 0 1 1');
  });

  it('supports zero-depth full circles and updates stable progress paths in place', async () => {
    document.body.innerHTML = '<nodel-readout label="Level" type="percent" visual="ring" ring-layout="edge" notch-depth="0%" value="0"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    const progress = readout.querySelector('.nodel-readout-edge-progress') as SVGPathElement;
    const svg = readout.querySelector('svg')!;
    const initialPath = progress.getAttribute('d');
    expect(initialPath).toContain('A 115 115 0 1 1');
    expect(progress.style.display).toBe('none');
    expect(progress.getAttribute('pathLength')).toBe('1');

    readout.setAttribute('value', '100');
    await Promise.resolve();
    expect(readout.querySelector('svg')).toBe(svg);
    expect(progress.getAttribute('d')).toBe(initialPath);
    expect(progress.style.strokeDasharray).toBe('1 1');
    expect(progress.style.display).toBe('');
  });

  it('maps every notch position to its stable ring rotation', async () => {
    document.body.innerHTML = '<nodel-readout type="percent" visual="ring" ring-layout="edge" value="50"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    const group = readout.querySelector('svg > g')!;
    const rotations: Record<string, string> = { bottom: '0', left: '90', top: '180', right: '270' };
    for (const [position, rotation] of Object.entries(rotations)) {
      readout.setAttribute('notch-position', position);
      await Promise.resolve();
      expect(group.getAttribute('transform')).toBe(`rotate(${rotation} 120 120)`);
    }
  });

  it('keeps the notch open at every progress fraction', async () => {
    document.body.innerHTML = '<nodel-readout type="percent" visual="ring" ring-layout="edge" value="0"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    const progress = readout.querySelector('.nodel-readout-edge-progress') as SVGPathElement;
    const track = readout.querySelector('.nodel-readout-edge-track') as SVGPathElement;
    const path = track.getAttribute('d')!;
    expect(path).toBeTruthy();

    for (const [value, fraction] of [['0', '0'], ['50', '0.5'], ['100', '1']] as Array<[string, string]>) {
      readout.setAttribute('value', value);
      await Promise.resolve();
      expect(progress.style.strokeDasharray).toBe(`${fraction} 1`);
      expect(progress.getAttribute('d')).toBe(path);
      expect(progress.getAttribute('d')).not.toMatch(/\sZ\s?/i);
    }
    expect(progress.style.display).toBe('');
  });

  it('keeps edge attributes visually inert outside an edge ring', async () => {
    document.body.innerHTML = `
      <nodel-readout type="percent" visual="bar" ring-layout="edge" notch-position="left" notch-depth="40%" value="50"></nodel-readout>
      <nodel-readout type="percent" visual="ring" notch-position="top" notch-depth="40%" value="50"></nodel-readout>
    `;
    await Promise.resolve();
    for (const readout of Array.from(document.querySelectorAll<HTMLElement>('nodel-readout'))) {
      const svg = readout.querySelector('.nodel-readout-edge-visual') as unknown as HTMLElement;
      expect(svg.hidden).toBe(true);
      expect(readout.dataset.notchPosition).toBeUndefined();
      expect(readout.dataset.notchDepth).toBeUndefined();
      expect(readout.querySelector('.nodel-readout-edge-track')?.getAttribute('d')).toBeNull();
    }
  });

  it('updates edge progress from signals without replacing SVG nodes', async () => {
    document.body.innerHTML = '<nodel-readout label="Level" type="percent" visual="ring" ring-layout="edge" signal="Level" value="20"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    const progress = readout.querySelector('.nodel-readout-edge-progress') as SVGPathElement;
    const svg = readout.querySelector('.nodel-readout-edge-visual');
    expect(progress.style.strokeDasharray).toBe('0.2 1');

    emitSignal('Level', 80);
    expect(readout.style.getPropertyValue('--nodel-readout-fraction')).toBe('0.8');
    expect(progress.style.strokeDasharray).toBe('0.8 1');
    expect(readout.querySelector('.nodel-readout-edge-progress')).toBe(progress);
    expect(readout.querySelector('.nodel-readout-edge-visual')).toBe(svg);
  });

  it('keeps a local-surface ring fallback when CSS masks are unavailable', async () => {
    const styles = await readStyleSource();

    expect(styles).toContain("nodel-readout[data-visual='ring'] .nodel-readout-visual::after");
    expect(styles).toContain('background: rgb(var(--nodel-surface));');
    expect(styles).toContain('@supports ((mask: radial-gradient');
    expect(styles).toContain("data-visual='ring'][data-ring-layout='edge'] .nodel-readout-edge-progress");
    expect(styles).not.toContain('vector-effect: non-scaling-stroke');
    expect(styles).toContain('container-type: size');
    expect(styles).toContain('font-size: 1.25rem;');
    expect(styles).toContain('@supports (width: 1cqmin)');
    expect(styles).toContain('inline-size: min(72cqmin, 14rem);');
    expect(styles).toContain('max-inline-size: 72cqmin;');
    expect(styles).toContain('font-size: clamp(1.25rem, 14cqmin, 3rem);');
    expect(styles).toContain("data-tone='soft'][data-visual='ring'][data-ring-layout='edge']");
    expect(styles).toContain("data-tone='outline'][data-visual='ring'][data-ring-layout='edge']");
    expect(styles).toContain('stroke: rgb(var(--nodel-fg)) !important;');
    expect(styles).toContain('stroke-width: 6 !important;');
    expect(styles).toContain('stroke-dasharray: 0.08 0.04 !important;');
    expect(styles).toContain('stroke-width: 12 !important;');
    expect(styles).toContain('stroke-dasharray: none !important;');
    expect(styles).toContain('stroke: rgb(var(--nodel-warning-fill)) !important;');
    expect(styles).toContain('stroke: rgb(var(--nodel-danger-fill)) !important;');
    expect(styles).toContain('stroke: CanvasText !important;');
    expect(styles).toContain('stroke: Highlight !important;');
    expect(styles).toContain('forced-color-adjust: none;');
    expect(styles).toContain('@media (forced-colors: active)');
  });

  it('keeps edge tone state dynamic while preserving the compact ring selectors', async () => {
    document.body.innerHTML = '<nodel-readout label="Level" type="percent" visual="ring" ring-layout="edge" tone="soft" value="50"></nodel-readout>';
    await Promise.resolve();
    const readout = document.querySelector('nodel-readout') as HTMLElement;
    expect(readout.dataset.tone).toBe('soft');
    readout.setAttribute('tone', 'outline');
    await Promise.resolve();
    expect(readout.dataset.tone).toBe('outline');

    const styles = await readStyleSource();
    expect(styles).toContain("nodel-readout[data-visual='ring'] .nodel-readout-visual {");
    expect(styles).toContain("nodel-readout[data-tone='soft'][data-visual='ring'] .nodel-readout-visual");
    expect(styles).toContain("nodel-readout[data-tone='outline'][data-visual='ring'] .nodel-readout-visual");
  });

  it('updates value, label, variant, suffix, and prefix from signals', async () => {
    document.body.innerHTML = '<nodel-readout signal="Temp" signals="Name:label; Tone:variant; Unit:suffix; Prefix:prefix" type="number"></nodel-readout>';
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const readout = document.querySelector('nodel-readout') as HTMLElement;
    emitSignal('Temp', 21);
    emitSignal('Name', 'Room');
    emitSignal('Tone', 'info');
    emitSignal('Unit', 'C');
    emitSignal('Prefix', '~');

    expect(readout.getAttribute('value')).toBe('21');
    expect(readout.getAttribute('label')).toBe('Room');
    expect(readout.dataset.variant).toBe('info');
    expect(readout.querySelector('.nodel-readout-value')?.textContent).toBe('~21C');
  });
});
