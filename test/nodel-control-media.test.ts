import { flush } from './helpers';
import { claimNodelPageActive } from '../src/data/visibility-scope';

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

import '../src/components/nodel-image';
import '../src/components/nodel-app';
import '../src/components/nodel-icon';
import '../src/components/nodel-status-indicator';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-06-06T00:00:00Z',
              source: 'local',
              type: 'event',
              alias,
              arg
            },
            changed: true,
            live: true
          }
        ],
        replace: false,
        transport: 'websocket',
        nextSeq: 2
      }
    });
  }
}

describe('control media components', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  it('renders nodel-image attributes and signal updates', async () => {
    document.body.innerHTML = '<nodel-image src="one.png" alt="One" label="Input" fit="cover" shape="circle" size="lg" variant="soft" signals="ImageSrc:src; ImageLabel:label"></nodel-image>';
    await customElements.whenDefined('nodel-image');
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    expect(image.dataset.fit).toBe('cover');
    expect(image.dataset.shape).toBe('circle');
    expect(image.dataset.size).toBe('lg');
    expect(image.dataset.variant).toBeUndefined();
    expect(image.querySelector('img')?.getAttribute('src')).toBe('one.png');
    expect(image.querySelector('.nodel-image-label')).toBeNull();
    expect(image.getAttribute('aria-label')).toBe('Input');

    emitSignal('ImageSrc', 'two.png');
    emitSignal('ImageLabel', 'Output');
    expect(image.querySelector('img')?.getAttribute('src')).toBe('two.png');
    expect(image.getAttribute('aria-label')).toBe('Output');
  });

  it('renders a non-loading placeholder for unsafe image sources', async () => {
    document.body.innerHTML = '<nodel-image src="javascript:alert(1)" alt="Unsafe"></nodel-image>';
    await flush();
    const image = document.querySelector('nodel-image') as HTMLElement;

    expect(image.dataset.sourceState).toBe('error');
    expect(image.querySelector('img')).toBeNull();
    expect(image.querySelector('.nodel-image-placeholder')).not.toBeNull();
    expect(image.getAttribute('role')).toBe('img');
    expect(image.getAttribute('aria-label')).toBe('Unsafe unavailable');
  });

  it('defers inactive app-page media while retaining state and accessibility', async () => {
    document.body.innerHTML = '<nodel-app><nodel-page title="Overview"></nodel-page><nodel-page hidden><nodel-image src="one.png" alt="One" label="Picture" signals="ImageSrc:src"></nodel-image></nodel-page></nodel-app>';
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    expect(image.dataset.sourceState).toBe('ready');
    expect(image.getAttribute('role')).toBe('img');
    expect(image.getAttribute('aria-label')).toBe('Picture');
    expect(image.querySelector('.nodel-image-media')).toBeNull();

    emitSignal('ImageSrc', 'two.png');
    expect(image.getAttribute('src')).toBe('two.png');
    expect(image.querySelector('.nodel-image-media')).toBeNull();

    const page = image.closest('nodel-page') as HTMLElement;
    page.removeAttribute('hidden');
    page.setAttribute('active', '');
    claimNodelPageActive(page, page.closest('nodel-app') as HTMLElement);
    await flush();
    expect(image.querySelector('.nodel-image-media')?.getAttribute('src')).toBe('two.png');
  });

  it('moves an alt-only name between the inactive host and active nested media', async () => {
    document.body.innerHTML = '<nodel-page hidden><nodel-image src="one.png" alt="One"></nodel-image></nodel-page>';
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    const page = image.closest('nodel-page') as HTMLElement;
    expect(image.getAttribute('role')).toBe('img');
    expect(image.getAttribute('aria-label')).toBe('One');
    expect(image.dataset.nodelAutoAriaLabel).toBe('true');
    expect(image.querySelector('.nodel-image-media')).toBeNull();

    page.removeAttribute('hidden');
    await flush();
    expect(image.getAttribute('role')).toBeNull();
    expect(image.getAttribute('aria-label')).toBeNull();
    expect(image.dataset.nodelAutoAriaLabel).toBeUndefined();
    expect(image.querySelector('.nodel-image-media')?.getAttribute('alt')).toBe('One');

    page.setAttribute('hidden', '');
    await flush();
    expect(image.getAttribute('role')).toBe('img');
    expect(image.getAttribute('aria-label')).toBe('One');
    expect(image.querySelector('.nodel-image-media')).toBeNull();
  });

  it('preserves an explicit aria-label authored while inactive', async () => {
    document.body.innerHTML = '<nodel-page hidden><nodel-image src="one.png" alt="One"></nodel-image></nodel-page>';
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    const page = image.closest('nodel-page') as HTMLElement;
    expect(image.dataset.nodelAutoAriaLabel).toBe('true');

    image.setAttribute('aria-label', 'Custom image');
    expect(image.getAttribute('aria-label')).toBe('Custom image');
    expect(image.dataset.nodelAutoAriaLabel).toBeUndefined();

    page.removeAttribute('hidden');
    await flush();
    expect(image.getAttribute('aria-label')).toBe('Custom image');
    expect(image.querySelector('.nodel-image-media')?.getAttribute('alt')).toBe('');
  });

  it('keeps aria-labelledby on the host while inactive and restores nested alt behavior', async () => {
    document.body.innerHTML = '<span id="image-name">Named image</span><nodel-page hidden><nodel-image src="one.png" alt="One" aria-labelledby="image-name"></nodel-image></nodel-page>';
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    const page = image.closest('nodel-page') as HTMLElement;
    expect(image.getAttribute('role')).toBe('img');
    expect(image.getAttribute('aria-labelledby')).toBe('image-name');
    expect(image.getAttribute('aria-label')).toBeNull();
    expect(image.querySelector('.nodel-image-media')).toBeNull();

    page.removeAttribute('hidden');
    await flush();
    expect(image.querySelector('.nodel-image-media')?.getAttribute('alt')).toBe('');
    expect(image.getAttribute('aria-labelledby')).toBe('image-name');
  });

  it('preserves the empty-source accessibility behavior while inactive', async () => {
    document.body.innerHTML = '<nodel-page hidden><nodel-image alt="Not yet available"></nodel-image></nodel-page>';
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    expect(image.dataset.sourceState).toBe('empty');
    expect(image.getAttribute('role')).toBeNull();
    expect(image.getAttribute('aria-label')).toBeNull();
    expect(image.querySelector('.nodel-image-placeholder')).not.toBeNull();
  });

  it('detaches and restores media across repeated page transitions without duplicate subscriptions', async () => {
    document.body.innerHTML = '<nodel-page><nodel-image src="one.png" signals="ImageSrc:src"></nodel-image></nodel-page>';
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    const page = image.closest('nodel-page') as HTMLElement;
    expect(image.querySelector('.nodel-image-media')).not.toBeNull();
    expect(activityMock.listeners).toHaveLength(1);

    page.setAttribute('hidden', '');
    await flush();
    expect(image.querySelector('.nodel-image-media')).toBeNull();
    page.removeAttribute('hidden');
    await flush();
    expect(image.querySelector('.nodel-image-media')).not.toBeNull();
    page.setAttribute('hidden', '');
    page.removeAttribute('hidden');
    await flush();
    expect(image.querySelectorAll('.nodel-image-media')).toHaveLength(1);
    expect(activityMock.listeners).toHaveLength(1);
  });

  it('starts suspended after reconnect until its page is active', async () => {
    document.body.innerHTML = '<nodel-page hidden><nodel-image src="one.png"></nodel-image></nodel-page>';
    await flush();
    const image = document.querySelector('nodel-image') as HTMLElement;
    const page = image.closest('nodel-page') as HTMLElement;
    expect(image.querySelector('.nodel-image-media')).toBeNull();

    image.remove();
    page.append(image);
    expect(image.querySelector('.nodel-image-media')).toBeNull();
    page.removeAttribute('hidden');
    await flush();
    expect(image.querySelector('.nodel-image-media')).not.toBeNull();
  });

  it('keeps active-page media through offline and document-hidden states', async () => {
    document.body.innerHTML = '<nodel-page><nodel-image src="one.png"></nodel-image></nodel-page>';
    await flush();
    const image = document.querySelector('nodel-image') as HTMLElement;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    window.dispatchEvent(new Event('offline'));
    await flush();
    expect(image.querySelector('.nodel-image-media')).not.toBeNull();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    window.dispatchEvent(new Event('online'));
  });

  it('renders nodel-icon and signal updates', async () => {
    document.body.innerHTML = '<nodel-icon name="power" label="Power" tone="accent" size="xl" variant="bordered" signals="IconName:name; IconTone:tone"></nodel-icon>';
    await customElements.whenDefined('nodel-icon');
    await flush();

    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.dataset.name).toBe('power');
    expect(icon.dataset.tone).toBe('accent');
    expect(icon.dataset.size).toBe('xl');
    expect(icon.dataset.variant).toBeUndefined();
    expect(icon.getAttribute('aria-label')).toBe('Power');

    emitSignal('IconName', 'volume');
    emitSignal('IconTone', 'success');
    expect(icon.dataset.name).toBe('volume');
    expect(icon.dataset.tone).toBe('success');
  });

  it('supports accessible icon alt text without a visible label', async () => {
    document.body.innerHTML = '<nodel-icon name="power" alt="Power" tone="accent"></nodel-icon>';
    await customElements.whenDefined('nodel-icon');
    await flush();

    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.getAttribute('aria-label')).toBe('Power');
    expect(icon.querySelector('.nodel-icon-label')).toBeNull();
  });

  it('renders nodel-status-indicator state from values and signals', async () => {
    document.body.innerHTML = '<nodel-status-indicator signal="Present" label="Signal present"></nodel-status-indicator>';
    await customElements.whenDefined('nodel-status-indicator');
    await flush();

    const indicator = document.querySelector('nodel-status-indicator') as HTMLElement;
    expect(indicator.dataset.state).toBe('off');
    expect(indicator.getAttribute('role')).toBe('status');

    emitSignal('Present', 'present');
    expect(indicator.dataset.state).toBe('on');

    emitSignal('Present', 'absent');
    expect(indicator.dataset.state).toBe('off');
  });

  it('supports exact on-value overrides for status indicators', async () => {
    document.body.innerHTML = '<nodel-status-indicator value="Locked" on-value="Available"></nodel-status-indicator>';
    await customElements.whenDefined('nodel-status-indicator');
    await flush();

    const indicator = document.querySelector('nodel-status-indicator') as HTMLElement;
    expect(indicator.dataset.state).toBe('off');
    indicator.setAttribute('value', 'Available');
    expect(indicator.dataset.state).toBe('on');
  });

  it('uses partial values before exact and inferred status values', async () => {
    document.body.innerHTML = '<nodel-status-indicator value="present" partial-on-value="present" partial-off-value="standby" on-value="ready" partial-tone="info"></nodel-status-indicator>';
    await flush();
    const indicator = document.querySelector('nodel-status-indicator') as HTMLElement;
    expect(indicator.dataset.state).toBe('partially-on');
    expect(indicator.dataset.partialTone).toBe('info');

    indicator.setAttribute('partial-tone', 'invalid');
    expect(indicator.dataset.partialTone).toBe('warning');

    indicator.setAttribute('value', 'standby');
    expect(indicator.dataset.state).toBe('partially-off');
    indicator.setAttribute('value', 'ready');
    expect(indicator.dataset.state).toBe('on');
    indicator.setAttribute('value', 'available');
    expect(indicator.dataset.state).toBe('on');
  });

  it('keeps dot-only defaults and optionally renders state labels', async () => {
    document.body.innerHTML = '<nodel-status-indicator value="mixed" partial-on-value="mixed" label="Zone state"></nodel-status-indicator>';
    await flush();
    const indicator = document.querySelector('nodel-status-indicator') as HTMLElement;
    expect(indicator.querySelector('.nodel-status-indicator-label')).toBeNull();
    expect(indicator.getAttribute('aria-label')).toBe('Zone state');

    indicator.setAttribute('show-state-label', '');
    indicator.setAttribute('partial-on-label', 'Some zones on');
    expect(indicator.querySelector('.nodel-status-indicator-label')?.textContent).toBe('Some zones on');
    expect(indicator.getAttribute('aria-label')).toBe('Zone state');
  });
});
