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

import { create } from 'qrcode';
import { flush } from './helpers';

import '../src/components/nodel-qrcode';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: { items: [{ entry: { seq: 1, timestamp: '2026-07-14T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 }
    });
  }
}

describe('nodel-qrcode', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  it('renders a high-correction SVG with a four-module quiet zone', async () => {
    document.body.innerHTML = '<nodel-qrcode value="https://example.org"></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    const svg = qr.querySelector('svg') as SVGSVGElement;
    const matrix = create('https://example.org', { errorCorrectionLevel: 'H' });
    const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number);
    const path = svg.querySelector('path');

    expect(qr.dataset.state).toBe('ready');
    expect(qr.dataset.size).toBe('128');
    expect(svg.getAttribute('width')).toBe('128');
    expect(viewBox).toEqual([0, 0, matrix.modules.size + 8, matrix.modules.size + 8]);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('white');
    expect(path?.getAttribute('fill')).toBe('black');
    expect(path?.getAttribute('d')).toMatch(/^M4 4/);
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
  });

  it('preserves whitespace and renders Unicode values', async () => {
    document.body.innerHTML = '<nodel-qrcode value=" x "></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    const whitespacePath = qr.querySelector('path')?.getAttribute('d');
    expect(qr.dataset.state).toBe('ready');

    qr.setAttribute('value', 'x');
    const trimmedPath = qr.querySelector('path')?.getAttribute('d');
    expect(whitespacePath).not.toBe(trimmedPath);

    qr.setAttribute('value', 'こんにちは QR');
    expect(qr.dataset.state).toBe('ready');
    expect(qr.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });

  it('renders an empty white placeholder without an error', async () => {
    document.body.innerHTML = '<nodel-qrcode size="200"></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    const svg = qr.querySelector('svg') as SVGSVGElement;

    expect(qr.dataset.state).toBe('empty');
    expect(qr.dataset.size).toBe('200');
    expect(svg.getAttribute('width')).toBe('200');
    expect(svg.querySelector('path')).toBeNull();
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('white');
    expect((qr.querySelector('.nodel-qrcode-error') as HTMLElement).hidden).toBe(true);
  });

  it('normalizes QR sizes to the safe bounds', async () => {
    document.body.innerHTML = '<nodel-qrcode value="size" size="not-a-size"></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    expect(qr.dataset.size).toBe('128');

    qr.setAttribute('size', '12');
    expect(qr.dataset.size).toBe('64');
    expect(qr.querySelector('svg')?.getAttribute('width')).toBe('64');

    qr.setAttribute('size', '2048');
    expect(qr.dataset.size).toBe('1024');
    expect(qr.querySelector('svg')?.getAttribute('width')).toBe('1024');
  });

  it('updates value, help, and label through signal bindings', async () => {
    document.body.innerHTML = '<nodel-qrcode signal="VisitorLink" signals="VisitorHelp:help; VisitorLabel:label"></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    emitSignal('VisitorLink', 'https://example.org/one');
    const firstPath = qr.querySelector('path')?.getAttribute('d');
    emitSignal('VisitorHelp', '<scan>');
    emitSignal('VisitorLabel', 'Visitor QR');
    emitSignal('VisitorLink', 'https://example.org/two');

    expect(qr.dataset.state).toBe('ready');
    expect(qr.querySelector('path')?.getAttribute('d')).not.toBe(firstPath);
    expect(qr.querySelector('.nodel-qrcode-help')?.textContent).toBe('<scan>');
    expect(qr.querySelector('.nodel-qrcode-help')?.querySelector('scan')).toBeNull();
    expect(qr.querySelector('svg')?.getAttribute('aria-label')).toBe('Visitor QR');

    for (const value of [42, true, { url: 'https://example.org' }, ['one', 'two']]) {
      emitSignal('VisitorLink', value);
      expect(qr.dataset.state).toBe('ready');
    }

    emitSignal('VisitorLink', '');
    expect(qr.dataset.state).toBe('empty');
    expect(qr.querySelector('path')).toBeNull();
  });

  it('uses safe accessible naming and links help text', async () => {
    document.body.innerHTML = '<span id="external-label">External label</span><nodel-qrcode value="label" aria-labelledby="external-label" aria-label="Ignored" label="Also ignored" help="Scan this code"></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    const svg = qr.querySelector('svg') as SVGSVGElement;
    const help = qr.querySelector('.nodel-qrcode-help') as HTMLElement;

    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-labelledby')).toBe('external-label');
    expect(svg.getAttribute('aria-label')).toBeNull();
    expect(svg.getAttribute('aria-describedby')).toBe(help.id);
    expect(help.textContent).toBe('Scan this code');

    qr.removeAttribute('aria-labelledby');
    expect(svg.getAttribute('aria-label')).toBe('Ignored');
    qr.removeAttribute('aria-label');
    expect(svg.getAttribute('aria-label')).toBe('Also ignored');
    qr.removeAttribute('label');
    expect(svg.getAttribute('aria-label')).toBe('QR code');
  });

  it('clears failed encodings and recovers without exposing the value', async () => {
    const tooLong = 'sensitive-' + 'x'.repeat(2200);
    let errorDetail: unknown;
    let errorCount = 0;
    document.body.innerHTML = '<nodel-qrcode></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    const qr = document.querySelector('nodel-qrcode') as HTMLElement;
    qr.addEventListener('nodel-qrcode-error', (event) => {
      errorCount += 1;
      errorDetail = (event as CustomEvent).detail;
    });
    qr.setAttribute('value', tooLong);

    expect(qr.dataset.state).toBe('error');
    expect(qr.querySelector('path')).toBeNull();
    expect(qr.querySelector('.nodel-qrcode-error')?.textContent).toBe('QR code unavailable');
    expect(errorCount).toBe(1);
    expect(JSON.stringify(errorDetail)).not.toContain(tooLong);
    expect(errorDetail).toEqual({ message: 'QR code unavailable', reason: 'encoding-failed' });

    qr.setAttribute('value', 'https://example.org/recovered');
    expect(qr.dataset.state).toBe('ready');
    expect(qr.querySelector('path')).not.toBeNull();
    expect((qr.querySelector('.nodel-qrcode-error') as HTMLElement).hidden).toBe(true);
  });

  it('disposes signal subscriptions when disconnected', async () => {
    document.body.innerHTML = '<nodel-qrcode signal="Link"></nodel-qrcode>';
    await customElements.whenDefined('nodel-qrcode');
    await flush();

    document.querySelector('nodel-qrcode')?.remove();
    expect(activityMock.dispose).toHaveBeenCalled();
  });
});
