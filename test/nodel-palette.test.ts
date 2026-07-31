import { flush } from './helpers';

const actionMock = vi.hoisted(() => ({ callNodeAction: vi.fn() }));
const activityMock = vi.hoisted(() => ({ listeners: [] as Array<(state: any) => void>, dispose: vi.fn() }));

vi.mock('../src/api/nodel-host-client', () => ({ callNodeAction: actionMock.callNodeAction }));
vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: activityMock.dispose };
  })
}));

import '../src/components/nodel-palette';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({ loading: false, connected: true, error: '', batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 } });
  }
}

describe('nodel-palette', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('renders swatch options and selected state', async () => {
    document.body.innerHTML = `
      <nodel-palette label="Colour" value="#00ff00" columns="3" shape="circle" show-labels="hide" variant="primary" tone="soft">
        <nodel-button value="#ff0000" color="#ff0000">Red</nodel-button>
        <nodel-button value="#00ff00" color="#00ff00">Green</nodel-button>
      </nodel-palette>
    `;
    await customElements.whenDefined('nodel-palette');
    await customElements.whenDefined('nodel-button');
    await flush();

    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const options = Array.from(document.querySelectorAll<HTMLElement>('nodel-button'));
    expect(palette.dataset.shape).toBe('circle');
    expect(palette.style.getPropertyValue('--nodel-palette-columns')).toBe('3');
    expect(options[0].dataset.paletteSwatch).toBe('true');
    expect(options[1].hasAttribute('active')).toBe(true);
    expect(options[1].getAttribute('variant')).toBe('primary');
    expect(options[1].getAttribute('tone')).toBe('soft');

    palette.setAttribute('value', '#ff0000');
    expect(options[0].hasAttribute('active')).toBe(true);
    expect(options[1].hasAttribute('active')).toBe(false);
    expect(options[1].hasAttribute('variant')).toBe(false);
    expect(options[1].hasAttribute('tone')).toBe(false);
  });

  it('preserves explicitly authored swatch appearance after selection moves', () => {
    document.body.innerHTML = `
      <nodel-palette value="#ff0000" variant="primary" tone="soft">
        <nodel-button value="#ff0000" variant="danger" tone="outline">Red</nodel-button>
        <nodel-button value="#0000ff">Blue</nodel-button>
      </nodel-palette>
    `;
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const options = Array.from(palette.querySelectorAll<HTMLElement>('nodel-button'));
    palette.setAttribute('value', '#0000ff');

    expect(options[0].hasAttribute('active')).toBe(false);
    expect(options[0].getAttribute('variant')).toBe('danger');
    expect(options[0].getAttribute('tone')).toBe('outline');
    expect(options[1].getAttribute('variant')).toBe('primary');
    expect(options[1].getAttribute('tone')).toBe('soft');
  });

  it('calls an action with selected colour value', async () => {
    document.body.innerHTML = '<nodel-palette action="SetColour"><nodel-button value="#ff0000" color="#ff0000">Red</nodel-button></nodel-palette>';
    await customElements.whenDefined('nodel-palette');
    await flush();

    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetColour', { arg: '#ff0000' });
    expect(document.querySelector('nodel-palette')?.getAttribute('value')).toBe('#ff0000');
  });

  it('supports native custom colour picker', async () => {
    document.body.innerHTML = '<nodel-palette picker="native"></nodel-palette>';
    await customElements.whenDefined('nodel-palette');
    await flush();

    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('input[type="color"]') as HTMLInputElement;
    const valueInput = palette.querySelector('.nodel-palette-value-input') as HTMLInputElement;
    const valueLabel = palette.querySelector('.nodel-palette-value-label') as HTMLLabelElement;
    expect(palette.dataset.valueField).toBe('readonly');
    expect(valueInput.readOnly).toBe(true);
    expect(valueLabel.hidden).toBe(false);
    expect(valueLabel.textContent).toContain('Colour value');
    input.value = '#123456';
    palette.querySelector('.nodel-palette-custom-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(palette.getAttribute('value')).toBe('#123456');
  });

  it('supports explicit editable and hidden custom value fields', () => {
    document.body.innerHTML = '<nodel-palette picker="native" value="#123456"></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const colorInput = palette.querySelector('.nodel-palette-custom-input') as HTMLInputElement;
    const valueInput = palette.querySelector('.nodel-palette-value-input') as HTMLInputElement;
    const valueLabel = palette.querySelector('.nodel-palette-value-label') as HTMLLabelElement;

    palette.setAttribute('value-field', 'editable');
    expect(palette.dataset.valueField).toBe('editable');
    expect(valueInput.readOnly).toBe(false);
    valueInput.value = 'rgb(0, 255, 0)';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(colorInput.value).toBe('#00ff00');

    palette.setAttribute('value-field', 'hidden');
    expect(palette.dataset.valueField).toBe('hidden');
    expect(valueLabel.hidden).toBe(true);
    expect(valueInput.readOnly).toBe(true);
    expect(colorInput.hidden).toBe(false);

    palette.setAttribute('value-field', 'unsupported');
    expect(palette.dataset.valueField).toBe('readonly');
    expect(valueLabel.hidden).toBe(false);
    expect(valueInput.readOnly).toBe(true);
  });

  it('uses join as action and updates from signals', async () => {
    document.body.innerHTML = '<nodel-palette join="Colour" signals="Name:label; Lock:disabled"><nodel-button value="#0000ff">Blue</nodel-button></nodel-palette>';
    await customElements.whenDefined('nodel-palette');
    await flush();

    const palette = document.querySelector('nodel-palette') as HTMLElement;
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Colour', { arg: '#0000ff' });

    emitSignal('Colour', '#ff0000');
    emitSignal('Name', 'LED Colour');
    emitSignal('Lock', true);
    expect(palette.getAttribute('value')).toBe('#ff0000');
    expect(palette.getAttribute('label')).toBe('LED Colour');
    expect(palette.hasAttribute('disabled')).toBe(true);
  });

  it.each([
    ['hex', '#00ff00'],
    ['rgb', 'rgb(0, 255, 0)'],
    ['hsl', 'hsl(120, 100%, 50%)'],
    ['hsv', 'hsv(120, 100%, 100%)']
  ])('formats canonical colours as %s action payloads', async (format, expected) => {
    document.body.innerHTML = `<nodel-palette action="SetColour" format="${format}"><nodel-button value="hsl(120, 100%, 50%)" color="#00ff00">Green</nodel-button></nodel-palette>`;
    await flush();
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetColour', { arg: expected });
    expect(document.querySelector('nodel-palette')?.getAttribute('value')).toBe('#00ff00');
  });

  it('validates and normalizes editable custom values without discarding the last valid colour', async () => {
    document.body.innerHTML = '<nodel-palette picker="native" value-field="editable" action="SetColour" format="rgb" value="#123456"></nodel-palette>';
    await flush();
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const valueInput = palette.querySelector('.nodel-palette-value-input') as HTMLInputElement;
    const colorInput = palette.querySelector('.nodel-palette-custom-input') as HTMLInputElement;
    const selectButton = palette.querySelector('.nodel-palette-custom-button') as HTMLButtonElement;

    valueInput.value = 'hsl(120, 100%, 50%)';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(valueInput.getAttribute('aria-invalid')).toBe('false');
    expect(colorInput.value).toBe('#00ff00');
    selectButton.click();
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetColour', { arg: 'rgb(0, 255, 0)' });
    expect(palette.getAttribute('value')).toBe('#00ff00');

    valueInput.value = 'not a colour';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(valueInput.getAttribute('aria-invalid')).toBe('true');
    expect(selectButton.disabled).toBe(true);
    expect(colorInput.value).toBe('#00ff00');
    expect(palette.getAttribute('value')).toBe('#00ff00');
  });

  it.each([
    ['rgb(1 2 3 / 50%)', '#01020380'],
    ['hsl(120 100% 50% / 50%)', '#00ff0080'],
    ['hsv(240 100% 100% / 25%)', '#0000ff40']
  ])('accepts modern alpha colour syntax %s', async (inputValue, expected) => {
    document.body.innerHTML = '<nodel-palette picker="native" value-field="editable" action="SetColour"></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('.nodel-palette-value-input') as HTMLInputElement;
    input.value = inputValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.getAttribute('aria-invalid')).toBe('false');
    (palette.querySelector('.nodel-palette-custom-button') as HTMLButtonElement).click();
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetColour', { arg: expected });
    expect(palette.getAttribute('value')).toBe(expected);
  });

  it('rejects malformed colour channel tokens', async () => {
    document.body.innerHTML = '<nodel-palette picker="native" value-field="editable" value="#123456"></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('.nodel-palette-value-input') as HTMLInputElement;
    input.value = 'rgb(1x, 2, 3)';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(palette.getAttribute('value')).toBe('#123456');
  });

  it.each([
    'rgb(1, 2, 3 / 50%)',
    'hsl(120, 100%, 50% / 50%)',
    'hsv(120, 100%, 50% / 50%)'
  ])('rejects mixed legacy and modern separator syntax %s', (inputValue) => {
    document.body.innerHTML = '<nodel-palette picker="native" value-field="editable" value="#123456"></nodel-palette>';
    const input = document.querySelector('.nodel-palette-value-input') as HTMLInputElement;
    input.value = inputValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it.each([
    ['rgb', 'rgba(0, 0, 255, 0.25098)'],
    ['hsl', 'hsla(240, 100%, 50%, 0.25098)'],
    ['hsv', 'hsva(240, 100%, 100%, 0.25098)']
  ])('preserves alpha precision in %s action payloads', async (format, expected) => {
    document.body.innerHTML = `<nodel-palette action="SetColour" format="${format}"><nodel-button value="#0000ff40">Blue</nodel-button></nodel-palette>`;
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetColour', { arg: expected });
  });

  it('keeps confirmation and signal state on the formatted colour path', async () => {
    document.body.innerHTML = '<nodel-palette action="SetColour" signal="Colour" format="hsv" confirm><nodel-button value="#00ff00">Green</nodel-button></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const confirm = vi.fn((event: Event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(true);
    });
    palette.addEventListener('nodel-confirm', confirm);
    emitSignal('Colour', 'hsl(120, 100%, 50%)');
    expect(palette.querySelector('nodel-button')?.hasAttribute('active')).toBe(true);

    palette.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetColour', { arg: 'hsv(120, 100%, 100%)' });
  });

  it('throttles live picker input, flushes the final change, and clamps its interval', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<nodel-palette picker="native" action="SetColour" live live-interval="10"></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('.nodel-palette-custom-input') as HTMLInputElement;
    expect(palette.dataset.liveInterval).toBe('50');

    input.value = '#111111';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
    input.value = '#222222';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '#333333';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(2);
    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetColour', { arg: '#333333' });
    vi.useRealTimers();
  });

  it('cancels pending live picker dispatch on disconnect', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<nodel-palette picker="native" action="SetColour" live live-interval="100"></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('.nodel-palette-custom-input') as HTMLInputElement;
    input.value = '#111111';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '#222222';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    palette.remove();
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keeps the final live value when action responses finish out of order', async () => {
    const resolvers: Array<() => void> = [];
    actionMock.callNodeAction.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    document.body.innerHTML = '<nodel-palette picker="native" action="SetColour" live live-interval="100"></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('.nodel-palette-custom-input') as HTMLInputElement;
    input.value = '#111111';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '#222222';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(resolvers).toHaveLength(2);

    resolvers[1]();
    await flush();
    resolvers[0]();
    await flush();
    expect(palette.getAttribute('value')).toBe('#222222');
  });

  it('ignores an older confirmation resolved after a newer selection', async () => {
    const confirmations: Array<{ resolve: (confirmed: boolean) => void }> = [];
    document.body.innerHTML = '<nodel-palette action="SetColour" confirm><nodel-button value="#ff0000">Red</nodel-button><nodel-button value="#0000ff">Blue</nodel-button></nodel-palette>';
    const palette = document.querySelector('nodel-palette') as HTMLElement;
    palette.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      confirmations.push((event as CustomEvent).detail);
    });
    const buttons = palette.querySelectorAll('nodel-button button');
    buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(confirmations).toHaveLength(2);

    confirmations[1].resolve(true);
    await flush();
    confirmations[0].resolve(true);
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetColour', { arg: '#0000ff' });
    expect(palette.getAttribute('value')).toBe('#0000ff');
  });
});
