import { flush, waitFor } from './helpers';

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected test value to be present');
  }
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const actsigMock = vi.hoisted(() => ({
  activityListeners: [] as Array<(state: any) => void>,
  activitySubscriptions: [] as Array<{ active: boolean; dispose: ReturnType<typeof vi.fn> }>,
  callNodeAction: vi.fn(),
  clipboardWriteText: vi.fn(),
  emitNodeSignal: vi.fn(),
  getNodeActions: vi.fn(),
  getNodeSignals: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  callNodeAction: actsigMock.callNodeAction,
  emitNodeSignal: actsigMock.emitNodeSignal,
  getNodeActions: actsigMock.getNodeActions,
  getNodeSignals: actsigMock.getNodeSignals
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    actsigMock.activityListeners.push(listener);
    const subscription = {
      active: true,
      dispose: vi.fn(() => {
        subscription.active = false;
      })
    };
    actsigMock.activitySubscriptions.push(subscription);
    return { dispose: subscription.dispose };
  })
}));

import '../src/components/nodel-actsig';
import '../src/components/nodel-toast-host';

const nativeClipboard = navigator.clipboard;
const nativeExecCommand = document.execCommand;

function installClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: actsigMock.clipboardWriteText }
  });
}

function restoreClipboard() {
  if (nativeClipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: nativeClipboard
    });
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
}

function submitForm(form: HTMLFormElement) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function setInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

async function setCheckboxValue(input: HTMLInputElement, checked: boolean) {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

function formByTitle(title: string) {
  return Array.from(document.querySelectorAll<HTMLFormElement>('.nodel-actsig-form')).find((form) => form.querySelector('h3')?.textContent?.trim() === title) ?? null;
}

async function openDetails(details: HTMLDetailsElement) {
  details.open = true;
  details.dispatchEvent(new Event('toggle', { bubbles: true }));
  await flush();
}

async function mountActSig(markup = '<nodel-actsig></nodel-actsig>') {
  document.body.innerHTML = markup;
  await customElements.whenDefined('nodel-actsig');
  await waitFor(() => actsigMock.getNodeActions.mock.calls.length === 1 && actsigMock.getNodeSignals.mock.calls.length === 1, {
    attempts: 100,
    intervalMs: 1
  });
  await waitFor(() => !document.body.textContent?.includes('Loading actions and signals'), {
    attempts: 100,
    intervalMs: 1
  });
  await flush();
  return document.querySelector('nodel-actsig')!;
}

describe('nodel-actsig', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    actsigMock.activityListeners = [];
    actsigMock.activitySubscriptions = [];
    actsigMock.callNodeAction.mockReset().mockResolvedValue({});
    actsigMock.clipboardWriteText.mockReset().mockResolvedValue(undefined);
    actsigMock.emitNodeSignal.mockReset().mockResolvedValue({});
    actsigMock.getNodeActions.mockReset().mockResolvedValue({});
    actsigMock.getNodeSignals.mockReset().mockResolvedValue({});
    installClipboard();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    restoreClipboard();
    if (nativeExecCommand) {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: nativeExecCommand
      });
    } else {
      Reflect.deleteProperty(document, 'execCommand');
    }
    vi.restoreAllMocks();
  });

  it('pairs actions and signals by name and lazily renders grouped rows', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Power: { name: 'Power', title: 'Power', order: 2, schema: { type: 'string', enum: ['On', 'Off'] } },
      Volume: { name: 'Volume', title: 'Volume', group: 'Audio', order: 2, schema: { type: 'integer', format: 'range', min: 0, max: 100 } }
    });
    actsigMock.getNodeSignals.mockResolvedValue({
      Power: { name: 'Power', title: 'Power State', schema: { type: 'boolean' } },
      Status: { name: 'Status', title: 'Status', group: 'Audio', order: 1, schema: { type: 'string' } }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('Power')) && Boolean(formByTitle('Power State')));

    const initialForms = Array.from(document.querySelectorAll('.nodel-actsig-form h3')).map((heading) => heading.textContent?.trim());
    expect(initialForms).toEqual(['Power', 'Power State']);
    expect(formByTitle('Volume')).toBeNull();
    expect(formByTitle('Status')).toBeNull();

    const section = document.querySelector<HTMLDetailsElement>('details[data-actsig-section-id]')!;
    expect(section.querySelector('.nodel-collapse-label')?.textContent).toBe('Audio');

    await openDetails(section);
    await waitFor(() => Boolean(formByTitle('Volume')) && Boolean(formByTitle('Status')));

    expect(section.querySelector('.nodel-collapse-content')?.classList.contains('space-y-3')).toBe(false);
    expect(section.querySelector('.nodel-collapse-content')?.classList.contains('gap-3')).toBe(true);
    const groupedTitles = Array.from(section.querySelectorAll('.nodel-actsig-form h3')).map((heading) => heading.textContent?.trim());
    expect(groupedTitles).toEqual(['Status', 'Volume']);
  });

  it('renders hostile action and schema display metadata as text', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Hostile: {
        name: 'Hostile',
        title: '<img src=x onerror=alert(1)>',
        desc: '<script>bad()</script>',
        schema: { type: 'string', title: '<svg onload=alert(1)>', desc: '<b>schema</b>' }
      }
    });

    const component = await mountActSig();
    const form = formByTitle('<img src=x onerror=alert(1)>')!;
    expect(form).toBeTruthy();
    expect(component.querySelector('img, script:not([type^="jsv"]), svg[onload]')).toBeNull();
    expect(component.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');

    await waitFor(() => Boolean(form.querySelector('[data-schema-field-input]')));
    expect(component.textContent).toContain('<svg onload=alert(1)>');
    expect(component.textContent).toContain('<b>schema</b>');
    expect(component.querySelector('b')).toBeNull();
  });

  it('keeps malformed UTF-16 form identities distinct and blocks only the unsupported request', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Isolated: { name: '\ud800', title: 'Isolated surrogate', schema: null },
      Replacement: { name: '\ufffd', title: 'Replacement character', schema: null }
    });

    await mountActSig();
    const isolated = formByTitle('Isolated surrogate')!;
    const replacement = formByTitle('Replacement character')!;

    expect(isolated.getAttribute('data-actsig-form-id')).not.toBe(replacement.getAttribute('data-actsig-form-id'));
    expect(isolated.textContent).toContain('cannot be represented safely');
    expect(isolated.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    submitForm(isolated);
    await flush();
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();

    submitForm(replacement);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);
    expect(actsigMock.callNodeAction).toHaveBeenCalledWith('\ufffd', {}, expect.anything());
  });

  it('blocks blank and unbounded generic JSON action arguments before calling the API', async () => {
    actsigMock.getNodeActions.mockResolvedValue({ Generic: { name: 'Generic', schema: {} } });
    await mountActSig();
    const form = formByTitle('Generic')!;
    const editor = form.querySelector<HTMLTextAreaElement>('[data-schema-field-input]')!;

    expect(editor).toBeTruthy();
    submitForm(form);
    await flush();
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();

    await setInputValue(editor, '1e400');
    submitForm(form);
    await flush();
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();

    await setInputValue(editor, '{"__proto__":{"safe":true},"constructor":"value"}');
    submitForm(form);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);
     const payload = required(actsigMock.callNodeAction.mock.calls[0])[1] as { arg: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(payload.arg, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload.arg, 'constructor')).toBe(true);
    expect(({} as { safe?: boolean }).safe).toBeUndefined();
  });

  it('serializes schema form values with original JSON property names', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Configure: {
        name: 'Configure',
        title: 'Configure',
        schema: {
          type: 'object',
          properties: {
            'ip-address': { type: 'string', title: 'IP address', order: 1 },
            count: { type: 'integer', title: 'Count', order: 2 },
            enabled: { type: 'boolean', title: 'Enabled', order: 3 },
            mode: { type: 'string', title: 'Mode', enum: ['On', 'Off'], order: 4 }
          }
        }
      }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('Configure')));

    const form = formByTitle('Configure')!;
    await openDetails(form.querySelector<HTMLDetailsElement>('details')!);
    await waitFor(() => form.querySelectorAll('input, select').length >= 4);

    await setInputValue(form.querySelector<HTMLInputElement>('input[type="text"]')!, '192.168.1.10');
    await setInputValue(form.querySelector<HTMLInputElement>('input[type="number"]')!, '5');
    await setCheckboxValue(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!, true);
    const mode = form.querySelector<HTMLSelectElement>('select')!;
    await setInputValue(mode, Array.from(mode.options).find((option) => option.text === 'On')!.value);

    submitForm(form);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);

    expect(actsigMock.callNodeAction).toHaveBeenCalledWith('Configure', {
      arg: {
        'ip-address': '192.168.1.10',
        count: 5,
        enabled: true,
        mode: 'On'
      }
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('blocks action calls for invalid strict numeric input', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      SetLevel: { name: 'SetLevel', title: 'Set Level', schema: { type: 'integer', min: 0, max: 10 } }
    });
    await mountActSig();
    const form = formByTitle('Set Level')!;
    const input = form.querySelector<HTMLInputElement>('input[type="number"]')!;
    await setInputValue(input, '3.5');
    submitForm(form);
    await flush();
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();
    expect(form.textContent).toContain('whole number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('opens and focuses a collapsed required action field with an accessible summary', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Configure: {
        name: 'Configure',
        title: 'Configure',
        schema: {
          type: 'object',
          properties: {
            settings: {
              type: 'object',
              title: 'Settings',
              required: true,
              properties: { host: { type: 'string', required: true } }
            }
          }
        }
      }
    });

    await mountActSig();
    const form = formByTitle('Configure')!;
    const root = form.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')!;
    expect(root.open).toBe(false);
    submitForm(form);
    await waitFor(() => Boolean(root.open && document.activeElement?.matches('[data-schema-field-input]')));
    const settings = Array.from(form.querySelectorAll<HTMLDetailsElement>('details.nodel-schema-nested'))
      .find((details) => details.querySelector('.nodel-collapse-label')?.textContent?.trim() === 'Settings')!;
    expect(settings.open).toBe(true);
    expect(settings.getAttribute('aria-describedby')).toBeTruthy();
    expect(Array.from(form.querySelectorAll('[role="alert"]')).some((alert) => alert.textContent?.includes('required'))).toBe(true);
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();
  });

  it('blocks signal emission for invalid required input', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      Status: { name: 'Status', title: 'Status', schema: { type: 'object', properties: { message: { type: 'string', required: true } } } }
    });
    await mountActSig();
    await setCheckboxValue(document.querySelector<HTMLInputElement>('[data-actsig-override]')!, true);
    const form = formByTitle('Status')!;
    const root = form.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')!;
    await openDetails(root);
    submitForm(form);
    await flush();
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();
    expect(form.textContent).toContain('required');
    expect(form.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('renders accessible copy icons and copies the technical action name', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'RunCommand', title: 'Run Command', schema: { type: 'null' } }
    });

    await mountActSig();
    const form = formByTitle('Run Command')!;
    const copyButton = form.querySelector<HTMLButtonElement>('[data-actsig-copy-id]')!;
    const toast = vi.fn();
    document.querySelector('nodel-actsig')?.addEventListener('nodel-toast', toast);

    expect(copyButton.type).toBe('button');
    expect(copyButton.classList.contains('nodel-actsig-copy')).toBe(true);
    expect(copyButton.classList.contains('nodel-button-ghost')).toBe(false);
    expect(copyButton.querySelector('[data-icon="copy"]')).not.toBeNull();
    expect(copyButton.title).toBe('Copy action name');
    expect(copyButton.getAttribute('aria-label')).toBe('Copy action name RunCommand');

    copyButton.click();
    await waitFor(() => actsigMock.clipboardWriteText.mock.calls.length === 1);
    await waitFor(() => toast.mock.calls.length === 1);

    expect(actsigMock.clipboardWriteText).toHaveBeenCalledWith('RunCommand');
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        id: 'nodel-actsig-copy-name',
        message: 'Action name copied',
        detail: 'RunCommand',
        tone: 'success'
      })
    }));
  });

  it('does not reserve form spacing when an action has no argument schema', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'Run', title: 'Run', schema: { type: 'null' } },
      Configure: { name: 'Configure', title: 'Configure', schema: { type: 'string' } }
    });

    await mountActSig();
    const runHeader = formByTitle('Run')!.querySelector<HTMLElement>(':scope > div')!;
    const configureHeader = formByTitle('Configure')!.querySelector<HTMLElement>(':scope > div')!;

    expect(runHeader.classList.contains('mb-2.5')).toBe(false);
    expect(configureHeader.classList.contains('mb-2.5')).toBe(true);
  });

  it('keeps signal copy icons enabled while signal override is off', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      Power: { name: 'PowerState', title: 'Power State', schema: { type: 'boolean' } }
    });

    await mountActSig();
    const form = formByTitle('Power State')!;
    const copyButton = form.querySelector<HTMLButtonElement>('[data-actsig-copy-id]')!;
    const emitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const signalInput = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    expect(copyButton.disabled).toBe(false);
    expect(emitButton.disabled).toBe(true);
    expect(signalInput.disabled).toBe(true);
    expect(form.querySelector('fieldset')?.getAttribute('aria-disabled')).toBe('true');

    copyButton.click();
    await waitFor(() => actsigMock.clipboardWriteText.mock.calls.length === 1);

    expect(actsigMock.clipboardWriteText).toHaveBeenCalledWith('PowerState');
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();
  });

  it('falls back to a temporary textarea when the modern clipboard rejects', async () => {
    actsigMock.clipboardWriteText.mockRejectedValue(new Error('Clipboard unavailable'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'RunCommand', title: 'Run Command', schema: { type: 'null' } }
    });

    await mountActSig();
    const toast = vi.fn();
    document.querySelector('nodel-actsig')?.addEventListener('nodel-toast', toast);
    formByTitle('Run Command')?.querySelector<HTMLButtonElement>('[data-actsig-copy-id]')?.click();
    await waitFor(() => execCommand.mock.calls.length === 1);
    await waitFor(() => toast.mock.calls.length === 1);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect(actsigMock.callNodeAction).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        message: 'Action name copied',
        detail: 'RunCommand',
        tone: 'success'
      })
    }));
  });

  it('reports a copy failure when both clipboard paths fail', async () => {
    actsigMock.clipboardWriteText.mockRejectedValue(new Error('Clipboard unavailable'));
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    actsigMock.getNodeSignals.mockResolvedValue({
      State: { name: 'StateChanged', title: 'State', schema: { type: 'string' } }
    });

    await mountActSig();
    const toast = vi.fn();
    const element = document.querySelector('nodel-actsig')!;
    element.addEventListener('nodel-toast', toast);
    formByTitle('State')?.querySelector<HTMLButtonElement>('[data-actsig-copy-id]')?.click();
    await waitFor(() => toast.mock.calls.length === 1);

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        id: 'nodel-actsig-copy-name',
        message: 'Failed to copy signal name',
        detail: 'Clipboard unavailable',
        tone: 'danger',
        durationMs: 7000
      })
    }));
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();
  });

  it('keeps button labels stable and replaces type icons while submitting', async () => {
    let resolveAction!: () => void;
    let resolveSignal!: () => void;
    actsigMock.callNodeAction.mockImplementation(() => new Promise<void>((resolve) => {
      resolveAction = resolve;
    }));
    actsigMock.emitNodeSignal.mockImplementation(() => new Promise<void>((resolve) => {
      resolveSignal = resolve;
    }));
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'Run', title: 'Run Action', schema: { type: 'null' } }
    });
    actsigMock.getNodeSignals.mockResolvedValue({
      State: { name: 'State', title: 'State Signal', schema: { type: 'null' } }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('Run Action')) && Boolean(formByTitle('State Signal')));

    const actionForm = formByTitle('Run Action')!;
    const actionButton = actionForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(actionButton.textContent?.trim()).toBe('Call');
    expect(actionForm.querySelector<HTMLElement>('.nodel-actsig-form-icon')?.dataset.actsigPointType).toBe('action');
    expect(actionForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.dataset.icon).toBe('person-running');

    submitForm(actionForm);
    await waitFor(() => actionButton.getAttribute('aria-busy') === 'true');

    expect(actionButton.textContent?.trim()).toBe('Call');
    expect(actionButton.disabled).toBe(true);
    expect(actionForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.dataset.icon).toBe('spinner');
    expect(actionForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.classList.contains('animate-spin')).toBe(true);

    resolveAction();
    await waitFor(() => actionButton.getAttribute('aria-busy') === 'false');
    expect(actionForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.dataset.icon).toBe('person-running');

    await setCheckboxValue(document.querySelector<HTMLInputElement>('[data-actsig-override]')!, true);
    const signalForm = formByTitle('State Signal')!;
    const signalButton = signalForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(signalButton.textContent?.trim()).toBe('Emit');
    expect(signalForm.querySelector<HTMLElement>('.nodel-actsig-form-icon')?.dataset.actsigPointType).toBe('event');
    expect(signalForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.dataset.icon).toBe('traffic-light');

    submitForm(signalForm);
    await waitFor(() => signalButton.getAttribute('aria-busy') === 'true');

    expect(signalButton.textContent?.trim()).toBe('Emit');
    expect(signalButton.disabled).toBe(true);
    expect(signalForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.dataset.icon).toBe('spinner');

    resolveSignal();
    await waitFor(() => signalButton.getAttribute('aria-busy') === 'false');
    expect(signalForm.querySelector<SVGElement>('.nodel-actsig-form-icon svg')?.dataset.icon).toBe('traffic-light');
  });

  it('pulses only the matching action or signal form for local activity', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'Run', title: 'Run Action', schema: { type: 'null' } }
    });
    actsigMock.getNodeSignals.mockResolvedValue({
      State: { name: 'State', title: 'State Signal', schema: { type: 'null' } }
    });

    await mountActSig();
    await waitFor(() => actsigMock.activityListeners.length === 1);
    const actionForm = formByTitle('Run Action')!;
    const signalForm = formByTitle('State Signal')!;

    vi.useFakeTimers();
    try {
      actsigMock.activityListeners[0]?.({
        loading: false,
        connected: true,
        error: '',
        batch: {
          replace: false,
          transport: 'websocket',
          nextSeq: 2,
          items: [
            {
              entry: {
                seq: 1,
                timestamp: '2026-01-01T00:00:00Z',
                source: 'local',
                type: 'action',
                alias: 'Run'
              },
              changed: true,
              live: true
            }
          ]
        }
      });

      expect(actionForm.classList.contains('is-pulsing')).toBe(true);
      expect(signalForm.classList.contains('is-pulsing')).toBe(false);

      await vi.advanceTimersByTimeAsync(699);
      expect(actionForm.classList.contains('is-pulsing')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(actionForm.classList.contains('is-pulsing')).toBe(false);

      actsigMock.activityListeners[0]?.({
        loading: false,
        connected: true,
        error: '',
        batch: {
          replace: false,
          transport: 'websocket',
          nextSeq: 3,
          items: [
            {
              entry: {
                seq: 2,
                timestamp: '2026-01-01T00:00:01Z',
                source: 'local',
                type: 'event',
                alias: 'State'
              },
              changed: true,
              live: true
            }
          ]
        }
      });

      expect(actionForm.classList.contains('is-pulsing')).toBe(false);
      expect(signalForm.classList.contains('is-pulsing')).toBe(true);
      await vi.advanceTimersByTimeAsync(700);
      expect(signalForm.classList.contains('is-pulsing')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('discovers the complete definition set once for one unseen local event', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Known: { name: 'Known', title: 'Known', schema: { type: 'null' } } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    await mountActSig();
    vi.useFakeTimers();
    try {
      actsigMock.getNodeActions.mockResolvedValueOnce({
        Known: { name: 'Known', title: 'Known', schema: { type: 'null' } },
        NewAction: { name: 'NewAction', title: 'New Action', schema: { type: 'string' } },
        AnotherAction: { name: 'AnotherAction', title: 'Another Action', schema: { type: 'number' } }
      });
      actsigMock.getNodeSignals.mockResolvedValueOnce({
        NewEvent: { name: 'NewEvent', title: 'New Event', schema: { type: 'boolean' } },
        AnotherEvent: { name: 'AnotherEvent', title: 'Another Event', schema: { type: 'string' } }
      });
      const listener = actsigMock.activityListeners[0]!;
      listener({ batch: { items: [{
        entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'NewEvent' }, changed: true, live: true
      }] } });
      await vi.advanceTimersByTimeAsync(199);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTimersAsync();

      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
      expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(2);
      expect(formByTitle('New Action')).not.toBeNull();
      expect(formByTitle('Another Action')).not.toBeNull();
      expect(formByTitle('New Event')).not.toBeNull();
      expect(formByTitle('Another Event')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not discover for known, remote, unbound, or binding activity', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Known: { name: 'Known', title: 'Known', schema: { type: 'null' } } });
    await mountActSig();
    const listener = actsigMock.activityListeners[0]!;
    listener({ batch: { items: [
      { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Known' }, changed: true, live: true },
      { entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'remote', type: 'action', alias: 'Unknown' }, changed: true, live: true },
      { entry: { seq: 3, timestamp: '2026-01-01T00:00:00Z', source: 'unbound', type: 'event', alias: 'Unknown' }, changed: true, live: true },
      { entry: { seq: 4, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'actionBinding', alias: 'Unknown' }, changed: true, live: true },
      { entry: { seq: 5, timestamp: '2026-01-01T00:00:00Z', source: 'remote', type: 'eventBinding', alias: 'Unknown' }, changed: true, live: true }
    ] } });
    await flush();
    expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(1);
    expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(1);
  });

  it('does not poll definitions when no unknown activity arrives', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Known: { name: 'Known', title: 'Known', schema: { type: 'null' } } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    await mountActSig();
    const actionReads = actsigMock.getNodeActions.mock.calls.length;
    const eventReads = actsigMock.getNodeSignals.mock.calls.length;
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(actionReads);
      expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(eventReads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry failed discovery from retained, empty, known, remote, or binding batches', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Known: { name: 'Known', schema: { type: 'null' } } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    await mountActSig();
    vi.useFakeTimers();
    try {
      actsigMock.getNodeActions.mockRejectedValueOnce(new Error('Definitions unavailable'));
      const listener = actsigMock.activityListeners[0]!;
      listener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Missing' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
      listener({ batch: { items: [] } });
      listener({ batch: { items: [
        { entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Known' }, changed: true, live: true },
        { entry: { seq: 3, timestamp: '2026-01-01T00:00:00Z', source: 'remote', type: 'event', alias: 'Missing' }, changed: true, live: true },
        { entry: { seq: 4, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'actionBinding', alias: 'Missing' }, changed: true, live: true },
        { entry: { seq: 5, timestamp: '2026-01-01T00:00:00Z', source: 'remote', type: 'eventBinding', alias: 'Missing' }, changed: true, live: true }
      ] } });
      await vi.advanceTimersByTimeAsync(4999);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);

      actsigMock.getNodeActions.mockResolvedValueOnce({ Later: { name: 'Later', title: 'Later', schema: { type: 'null' } } });
      actsigMock.getNodeSignals.mockResolvedValueOnce({});
      listener({ batch: { items: [{ entry: { seq: 6, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Later' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(199);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces multiple unseen aliases arriving within 200ms into one request pair', async () => {
    await mountActSig();
    const listener = actsigMock.activityListeners[0]!;
    vi.useFakeTimers();
    try {
      listener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'First' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(100);
      listener({ batch: { items: [{ entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Second' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(99);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(1);
      expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
      expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks in-flight unknown identities and performs at most one trailing check for a miss', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({});
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    await mountActSig();
    vi.useFakeTimers();
    try {
      const actions = deferred<Record<string, any>>();
      const signals = deferred<Record<string, any>>();
      actsigMock.getNodeActions.mockReturnValueOnce(actions.promise).mockResolvedValueOnce({ First: { name: 'First', schema: { type: 'null' } } });
      actsigMock.getNodeSignals.mockReturnValueOnce(signals.promise).mockResolvedValueOnce({});
      const listener = actsigMock.activityListeners[0]!;
      const emit = (alias: string) => listener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias }, changed: true, live: true }] } });
      listener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'First' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
      listener({ batch: { items: [{ entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'First' }, changed: true, live: true }] } });
      emit('Missed');
      actions.resolve({ First: { name: 'First', schema: { type: 'null' } } });
      signals.resolve({});
      await Promise.resolve();
      await Promise.resolve();
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5000);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(3);
      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(5000);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves equal-refresh DOM, drafts, focus, groups, and pulse timers intact', async () => {
    const definitions = {
      Run: { name: 'Run', title: 'Run', schema: { type: 'string' } },
      Grouped: { name: 'Grouped', title: 'Grouped', group: 'More', schema: { type: 'null' } }
    };
    actsigMock.getNodeActions.mockResolvedValueOnce(definitions);
    await mountActSig();
    const form = formByTitle('Run')!;
    const input = form.querySelector<HTMLInputElement>('[data-schema-field-input]')!;
    await setInputValue(input, 'draft');
    input.focus();
    const group = document.querySelector<HTMLDetailsElement>('details[data-actsig-section-id]')!;
    await openDetails(group);
    const listener = actsigMock.activityListeners[0]!;
    vi.useFakeTimers();
    try {
      actsigMock.getNodeActions.mockResolvedValueOnce(definitions);
      actsigMock.getNodeSignals.mockResolvedValueOnce({});
      listener({ batch: { items: [
        { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Run' }, changed: true, live: true },
        { entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Unknown' }, changed: true, live: true }
      ] } });
      const originalForm = form;
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      expect(formByTitle('Run')).toBe(originalForm);
      expect(input.value).toBe('draft');
      expect(document.activeElement).toBe(input);
      expect(group.open).toBe(true);
      expect(form.classList.contains('is-pulsing')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps existing controls usable while an activity refresh is pending', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Run: { name: 'Run', title: 'Run', schema: { type: 'null' } } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    await mountActSig();
    const form = formByTitle('Run')!;
    const actions = deferred<Record<string, any>>();
    const signals = deferred<Record<string, any>>();
    actsigMock.getNodeActions.mockReturnValueOnce(actions.promise);
    actsigMock.getNodeSignals.mockReturnValueOnce(signals.promise);
    vi.useFakeTimers();
    try {
      actsigMock.activityListeners[0]?.({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'NewEvent' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(200);

      expect(formByTitle('Run')).toBe(form);
      expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
      submitForm(form);
      await Promise.resolve();
      expect(actsigMock.callNodeAction).toHaveBeenCalledWith('Run', {}, expect.anything());

      actions.resolve({ Run: { name: 'Run', title: 'Run', schema: { type: 'null' } } });
      signals.resolve({});
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps restart-equal definitions and form state without rebuilding', async () => {
    const definitions = { Run: { name: 'Run', title: 'Run', schema: { type: 'string' } } };
    actsigMock.getNodeActions.mockResolvedValueOnce(definitions);
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    const actsig = await mountActSig();
    const form = formByTitle('Run')!;
    const input = form.querySelector<HTMLInputElement>('[data-schema-field-input]')!;
    await setInputValue(input, 'draft');
    input.focus();
    const toast = vi.fn();
    actsig.addEventListener('nodel-toast', toast);
    actsigMock.getNodeActions.mockResolvedValueOnce({ Run: { name: 'Run', title: 'Run', schema: { type: 'string' }, seq: 4 } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});

    const result = await (actsig as any).refreshAfterRestart();

    expect(result).toEqual({ status: 'verified', changed: false });
    expect(formByTitle('Run')).toBe(form);
    expect(input.value).toBe('draft');
    expect(document.activeElement).toBe(input);
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ id: 'nodel-actsig-refresh-warning' }) }));
  });

  it('cancels activity on restart, suppresses refresh-time activity, and reports no activity toast', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Run: { name: 'Run', schema: { type: 'null' } } });
    await mountActSig();
    const actsig = document.querySelector('nodel-actsig')!;
    const listener = actsigMock.activityListeners[0]!;
    const toast = vi.fn();
    actsig.addEventListener('nodel-toast', toast);
    vi.useFakeTimers();
    try {
      listener({ batch: { items: [
        { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Run' }, changed: true, live: true },
        { entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Missing' }, changed: true, live: true }
      ] } });
      expect(actsig.querySelector('.is-pulsing')).not.toBeNull();
      actsigMock.getNodeActions.mockRejectedValueOnce(new Error('Restart unavailable'));
      actsigMock.getNodeSignals.mockResolvedValueOnce({});
      const restart = (actsig as any).refreshAfterRestart() as Promise<unknown>;
      listener({ batch: { items: [{ entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'DuringRestart' }, changed: true, live: true }] } });
      await restart;
      await vi.advanceTimersByTimeAsync(5000);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
      expect(toast).not.toHaveBeenCalled();
      expect((actsig as any).pendingActivity.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps activity suppressed for the latest of overlapping restart refreshes', async () => {
    await mountActSig();
    const actsig = document.querySelector('nodel-actsig')!;
    const listener = actsigMock.activityListeners[0]!;
    const olderActions = deferred<Record<string, any>>();
    const olderSignals = deferred<Record<string, any>>();
    const latestActions = deferred<Record<string, any>>();
    const latestSignals = deferred<Record<string, any>>();
    actsigMock.getNodeActions
      .mockReturnValueOnce(olderActions.promise)
      .mockReturnValueOnce(latestActions.promise);
    actsigMock.getNodeSignals
      .mockReturnValueOnce(olderSignals.promise)
      .mockReturnValueOnce(latestSignals.promise);

    const older = (actsig as any).refreshAfterRestart() as Promise<unknown>;
    const latest = (actsig as any).refreshAfterRestart() as Promise<unknown>;
    expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(3);

    listener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'DuringLatestRestart' }, changed: true, live: true }] } });
    olderActions.resolve({});
    olderSignals.resolve({});
    await expect(older).resolves.toMatchObject({ status: 'superseded' });

    vi.useFakeTimers();
    try {
      listener({ batch: { items: [{ entry: { seq: 2, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'StillSuppressed' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(5000);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(3);

      latestActions.resolve({});
      latestSignals.resolve({});
      await expect(latest).resolves.toMatchObject({ status: 'verified' });
      listener({ batch: { items: [{ entry: { seq: 3, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'AfterLatestRestart' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a disconnected restart suppress discovery after reconnect', async () => {
    const actsig = await mountActSig();
    const staleActions = deferred<Record<string, any>>();
    const staleSignals = deferred<Record<string, any>>();
    actsigMock.getNodeActions.mockReturnValueOnce(staleActions.promise);
    actsigMock.getNodeSignals.mockReturnValueOnce(staleSignals.promise);
    const staleRestart = (actsig as any).refreshAfterRestart() as Promise<unknown>;
    expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);

    actsig.remove();
    document.body.append(actsig);
    await waitFor(() => actsigMock.getNodeActions.mock.calls.length === 3 && actsigMock.activityListeners.length === 2);
    staleActions.resolve({});
    staleSignals.resolve({});
    await expect(staleRestart).resolves.toMatchObject({ status: 'superseded' });

    vi.useFakeTimers();
    try {
      actsigMock.activityListeners[1]!({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'AfterReconnect' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deduplicates activity warning identity and bounds failure detail', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Run: { name: 'Run', title: 'Run', schema: { type: 'null' } } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    await mountActSig();
    const actsig = document.querySelector('nodel-actsig')!;
    const existingForm = formByTitle('Run')!;
    const toastHost = document.createElement('nodel-toast-host');
    document.body.append(toastHost);
    document.body.addEventListener('nodel-toast', (event) => (toastHost as any).show((event as CustomEvent).detail));
    const events: CustomEvent[] = [];
    actsig.addEventListener('nodel-toast', (event) => events.push(event as CustomEvent));
    vi.useFakeTimers();
    try {
      const detail = 'x'.repeat(500);
      actsigMock.getNodeActions.mockRejectedValueOnce(new Error(detail));
      actsigMock.getNodeSignals.mockResolvedValueOnce({});
      const listener = actsigMock.activityListeners[0]!;
      const emit = () => listener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Missing' }, changed: true, live: true }] } });
      emit();
      await vi.advanceTimersByTimeAsync(200);
       await Promise.resolve();
       await Promise.resolve();
       expect(events).toHaveLength(1);
       expect(formByTitle('Run')).toBe(existingForm);
       expect(existingForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
       expect(events[0]?.detail).toMatchObject({ id: 'nodel-actsig-refresh-warning', tone: 'warning', durationMs: 7000 });
      expect(events[0]?.detail.detail.length).toBeLessThanOrEqual(240);

      actsigMock.getNodeActions.mockRejectedValueOnce(new Error(detail));
      actsigMock.getNodeSignals.mockResolvedValueOnce({});
      emit();
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      expect(events).toHaveLength(2);
      expect(events[1]?.detail.id).toBe(events[0]?.detail.id);
      expect(document.querySelectorAll('.nodel-toast')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not toast when an in-flight activity refresh is superseded', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({});
    await mountActSig();
    const actsig = document.querySelector('nodel-actsig')!;
    const toast = vi.fn();
    actsig.addEventListener('nodel-toast', toast);
    const actions = deferred<Record<string, any>>();
    const signals = deferred<Record<string, any>>();
    actsigMock.getNodeActions.mockReturnValueOnce(actions.promise).mockResolvedValueOnce({});
    actsigMock.getNodeSignals.mockReturnValueOnce(signals.promise).mockResolvedValueOnce({});
    vi.useFakeTimers();
    try {
      actsigMock.getNodeActions.mockResolvedValueOnce({});
      actsigMock.getNodeSignals.mockResolvedValueOnce({});
      actsigMock.activityListeners[0]?.({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Missing' }, changed: true, live: true }] } });
      await vi.advanceTimersByTimeAsync(200);
      const restart = (actsig as any).refreshAfterRestart() as Promise<unknown>;
      await restart;
      actions.resolve({});
      signals.resolve({});
      await Promise.resolve();
      await Promise.resolve();
      expect(toast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates pristine action arguments but preserves edited action fields during later activity', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'Run', title: 'Run Action', schema: { type: 'string' } },
      Other: { name: 'Other', title: 'Other Action', schema: { type: 'string' } }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('Run Action')) && Boolean(formByTitle('Other Action')));
    const edited = formByTitle('Run Action')!;
    await setInputValue(edited.querySelector<HTMLInputElement>('[data-schema-field-input]')!, 'manual');

    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 3,
        items: [
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Run', arg: 'activity' }, changed: true, live: true },
          { entry: { seq: 2, timestamp: '2026-01-01T00:00:01Z', source: 'local', type: 'action', alias: 'Other', arg: 'pristine' }, changed: true, live: true }
        ]
      }
    });
    await flush();

    expect(edited.querySelector<HTMLInputElement>('[data-schema-field-input]')?.value).toBe('manual');
    expect(formByTitle('Other Action')?.querySelector<HTMLInputElement>('[data-schema-field-input]')?.value).toBe('pristine');
    submitForm(edited);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);
    expect(actsigMock.callNodeAction).toHaveBeenCalledWith('Run', { arg: 'manual' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('preserves unknown activity metadata through action calls and signal emissions', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Run: { name: 'Run', title: 'Run Action', schema: { type: 'object', properties: { known: { type: 'string' } } } }
    });
    actsigMock.getNodeSignals.mockResolvedValue({
      State: { name: 'State', title: 'State Signal', schema: { type: 'object', properties: { known: { type: 'string' } } } }
    });

    await mountActSig();
    await setCheckboxValue(document.querySelector<HTMLInputElement>('[data-actsig-override]')!, true);
    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 3,
        items: [
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Run', arg: { known: 'action-live', extra: { keep: 'action' } } }, changed: true, live: true },
          { entry: { seq: 2, timestamp: '2026-01-01T00:00:01Z', source: 'local', type: 'event', alias: 'State', arg: { known: 'signal-live', extra: { keep: 'signal' } } }, changed: true, live: true }
        ]
      }
    });
    await flush();

    const action = formByTitle('Run Action')!;
    await openDetails(action.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')!);
    await setInputValue(action.querySelector<HTMLInputElement>('[data-schema-field-input]')!, 'action-edited');
    submitForm(action);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);

    const signal = formByTitle('State Signal')!;
    await openDetails(signal.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')!);
    await setInputValue(signal.querySelector<HTMLInputElement>('[data-schema-field-input]')!, 'signal-edited');
    submitForm(signal);
    await waitFor(() => actsigMock.emitNodeSignal.mock.calls.length === 1);

    expect(required(actsigMock.callNodeAction.mock.calls[0])[1]).toEqual({ arg: { known: 'action-edited', extra: { keep: 'action' } } });
    expect(required(actsigMock.emitNodeSignal.mock.calls[0])[1]).toEqual({ arg: { known: 'signal-edited', extra: { keep: 'signal' } } });
  });

  it('preserves dirty nullable scalar array state and IDs during later action activity', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      Run: {
        name: 'Run',
        title: 'Run Action',
        schema: { type: 'array', items: { type: [{ type: 'string' }, { type: 'null' }] } }
      }
    });

    await mountActSig();
    const form = formByTitle('Run Action')!;
    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 2,
        items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Run', arg: ['initial', 'second'] }, changed: true, live: true }]
      }
    });
    await flush();
    await openDetails(form.querySelector<HTMLDetailsElement>('details')!);
    const firstInput = form.querySelector<HTMLInputElement>('[data-schema-field-input]')!;
    await setInputValue(firstInput, 'manual');
    let states = Array.from(form.querySelectorAll<HTMLSelectElement>('[data-schema-presence]'));
    expect(states).toHaveLength(2);
    await setInputValue(required(states[0]), 'null');

    const host = document.querySelector('nodel-actsig') as any;
    const model = host.state.sections.flatMap((section: any) => section.rows).find((row: any) => row.action?.name === 'Run').action;
    const entryId = model.schemaForm.fields[0].entries[0].id;

    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 3,
        items: [{ entry: { seq: 2, timestamp: '2026-01-01T00:00:01Z', source: 'local', type: 'action', alias: 'Run', arg: ['activity', 'updated'] }, changed: true, live: true }]
      }
    });
    await flush();

    const refreshed = host.state.sections.flatMap((section: any) => section.rows).find((row: any) => row.action?.name === 'Run').action;
    const firstEntry = refreshed.schemaForm.fields[0].entries[0];
    states = Array.from(form.querySelectorAll<HTMLSelectElement>('[data-schema-presence]'));
    expect(required(states[0]).value).toBe('null');
    expect(firstEntry.id).toBe(entryId);
    expect(firstEntry.valueField.value).toBeNull();
    expect(firstEntry.valueField.concreteValue).toBe('manual');
    expect(firstEntry.valueField.presenceState).toBe('null');
    expect(firstEntry.valueField.dirty).toBe(true);

    submitForm(form);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);
    expect(required(actsigMock.callNodeAction.mock.calls[0])[1]).toEqual({ arg: [null, 'updated'] });
  });

  it('renders root object action args as a collapsible group while keeping nested arrays collapsible', async () => {
    actsigMock.getNodeActions.mockResolvedValue({
      WledSetState: {
        name: 'WledSetState',
        title: 'WLED Set State',
        schema: {
          type: 'object',
          properties: {
            on: { type: 'boolean', title: 'On', order: 1 },
            brightness: { type: 'integer', title: 'Brightness', order: 2 },
            transition: { type: 'integer', title: 'Transition', order: 3 },
            segments: {
              type: 'array',
              title: 'Segments',
              order: 4,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer', title: 'ID', order: 1 },
                  colour: { type: 'string', title: 'Colour', order: 2 }
                }
              }
            },
            playlist: { type: 'string', title: 'Playlist', order: 5 }
          }
        }
      }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('WLED Set State')));

    const form = formByTitle('WLED Set State')!;
    const rootGroup = form.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')!;
    expect(rootGroup).not.toBeNull();
    expect(rootGroup.open).toBe(false);
    expect(rootGroup.querySelector('summary')?.textContent?.trim()).toBe('');
    expect(form.textContent).not.toContain('Details');
    expect(form.textContent).not.toContain('arg');

    await openDetails(rootGroup);
    await waitFor(() => Boolean(form.querySelector<HTMLInputElement>('input[type="checkbox"]')));
    expect(rootGroup.querySelector('.nodel-schema-root-object-content')).not.toBeNull();
    expect(rootGroup.querySelectorAll('.nodel-schema-field').length).toBeGreaterThan(1);

    const details = Array.from(form.querySelectorAll<HTMLDetailsElement>('details.nodel-schema-nested'));
    expect(details.map((detail) => detail.querySelector('summary')?.textContent?.trim())).toEqual(['Segments']);
    expect(form.textContent).not.toContain('Details');
    expect(form.textContent).not.toContain('arg');
    expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')).not.toBeNull();
    expect(form.querySelectorAll<HTMLInputElement>('input[type="number"]')).toHaveLength(2);
    expect(form.querySelector<HTMLInputElement>('input[type="text"]')).not.toBeNull();

    await setCheckboxValue(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!, true);
    const numberInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    await setInputValue(required(numberInputs[0]), '128');
    await setInputValue(required(numberInputs[1]), '7');
    await setInputValue(form.querySelector<HTMLInputElement>('input[type="text"]')!, 'party');

    submitForm(form);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);

    expect(actsigMock.callNodeAction).toHaveBeenCalledWith('WledSetState', {
      arg: {
        on: true,
        brightness: 128,
        transition: 7,
        playlist: 'party'
      }
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('keeps signals disabled until override is enabled then emits signal payloads', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      Power: { name: 'Power', title: 'Power State', schema: { type: 'boolean' } }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('Power State')));

    const form = formByTitle('Power State')!;
    expect(form.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(false);
    expect(form.querySelector<HTMLFieldSetElement>('fieldset')?.getAttribute('aria-disabled')).toBe('true');
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);

    submitForm(form);
    await flush();
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();

    await setCheckboxValue(document.querySelector<HTMLInputElement>('[data-actsig-override]')!, true);
    await waitFor(() => form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled === false);
    expect(form.querySelector<HTMLFieldSetElement>('fieldset')?.getAttribute('aria-disabled')).toBe('false');
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    await setCheckboxValue(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!, true);
    submitForm(form);
    await waitFor(() => actsigMock.emitNodeSignal.mock.calls.length === 1);

    expect(actsigMock.emitNodeSignal).toHaveBeenCalledWith('Power', { arg: true }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('allows read-only object signals to expand while keeping controls disabled', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      WledCurrentState: {
        name: 'WledCurrentState',
        title: 'WLED Current State',
        schema: {
          type: 'object',
          properties: {
            on: { type: 'boolean', title: 'On', order: 1 },
            brightness: { type: 'integer', title: 'Brightness', order: 2 },
            effect: { type: 'string', title: 'Effect', order: 3 }
          }
        }
      }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('WLED Current State')));
    await waitFor(() => actsigMock.activityListeners.length === 1);

    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-01-01T00:00:00Z',
              source: 'local',
              type: 'event',
              alias: 'WledCurrentState',
              arg: { on: true, brightness: 52, effect: 'Rainbow' }
            },
            changed: true,
            live: true
          }
        ]
      }
    });

    await flush();
    const form = formByTitle('WLED Current State')!;
    const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
    expect(fieldset.disabled).toBe(false);
    expect(fieldset.getAttribute('aria-disabled')).toBe('true');

    const rootGroup = form.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')!;
    expect(rootGroup.open).toBe(false);

    await openDetails(rootGroup);
    await waitFor(() => Boolean(form.querySelector<HTMLInputElement>('input[type="number"]')));

    expect(rootGroup.open).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('52');
    expect(form.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true);
    expect(form.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Rainbow');
    expect(form.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);

    submitForm(form);
    await flush();
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();
  });

  it('keeps read-only signals shaped by their declared schema when values mismatch', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      WledCurrentState: {
        name: 'WledCurrentState',
        title: 'WLED Current State',
        schema: { type: 'string' }
      }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('WLED Current State')));
    await waitFor(() => actsigMock.activityListeners.length === 1);

    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-01-01T00:00:00Z',
              source: 'local',
              type: 'event',
              alias: 'WledCurrentState',
              arg: { on: true, brightness: 52, effect: 'Rainbow' }
            },
            changed: true,
            live: true
          }
        ]
      }
    });

    await flush();
    const form = formByTitle('WLED Current State')!;
    expect(form.querySelector<HTMLDetailsElement>('details.nodel-schema-root-object')).toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();
  });

  it('caches grouped activity updates and hydrates when expanded', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      Status: { name: 'Status', title: 'Status', group: 'State', schema: { type: 'string' } }
    });

    await mountActSig();
    await waitFor(() => actsigMock.activityListeners.length === 1);
    expect(formByTitle('Status')).toBeNull();

    actsigMock.activityListeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Status', arg: 'Ready' }, changed: true, live: true }
        ]
      }
    });

    const section = document.querySelector<HTMLDetailsElement>('details[data-actsig-section-id]')!;
    await openDetails(section);
    await waitFor(() => Boolean(formByTitle('Status')));

    expect(formByTitle('Status')?.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Ready');
  });

  it('shows only the load error when definitions fail to load', async () => {
    actsigMock.getNodeActions.mockRejectedValue(new Error('Actions unavailable'));
    actsigMock.getNodeSignals.mockResolvedValue({
      Status: { name: 'Status', title: 'Status', schema: { type: 'string' } }
    });

    await mountActSig();

    expect(document.body.textContent).toContain('Actions unavailable');
    expect(document.body.textContent).not.toContain('No actions or signals.');
    expect(document.querySelector('[data-actsig-override]')).toBeNull();
  });

  it('keeps existing controls through pending and failed restart refreshes', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({ Run: { name: 'Run', title: 'Run', schema: { type: 'null' } } });
    actsigMock.getNodeSignals.mockResolvedValueOnce({});
    const element = await mountActSig();
    const existingForm = formByTitle('Run')!;
    expect(existingForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    const actions = deferred<Record<string, any>>();
    const signals = deferred<Record<string, any>>();
    actsigMock.getNodeActions.mockReturnValueOnce(actions.promise);
    actsigMock.getNodeSignals.mockReturnValueOnce(signals.promise);
    const refresh = (element as any).refreshAfterRestart() as Promise<unknown>;

    expect(formByTitle('Run')).toBe(existingForm);
    expect(element.textContent).not.toContain('Loading actions and signals');
    expect(existingForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    actions.reject(new Error('Restart actions unavailable'));
    signals.resolve({});
    const result = await refresh;

    expect(result).toMatchObject({ status: 'failed', detail: 'Restart actions unavailable' });
    expect(formByTitle('Run')).toBe(existingForm);
    expect(existingForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(element.textContent).toContain('Restart actions unavailable');
  });

  it('refreshes definitions after a node restart while preserving signal override mode', async () => {
    actsigMock.getNodeActions.mockResolvedValueOnce({
      Power: { name: 'Power', title: 'Power', schema: { type: 'boolean' } }
    });
    actsigMock.getNodeSignals.mockResolvedValueOnce({
      State: { name: 'State', title: 'State', schema: { type: 'string' } }
    });

    const element = await mountActSig();
    await setCheckboxValue(document.querySelector<HTMLInputElement>('[data-actsig-override]')!, true);
    const initialForm = formByTitle('Power')!;
    const initialListener = actsigMock.activityListeners[0]!;
    initialListener({ batch: { items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Power', arg: true }, changed: true, live: true }] } });
    await flush();
    expect(initialForm.classList.contains('is-pulsing')).toBe(true);

    actsigMock.getNodeActions.mockResolvedValueOnce({
      Level: { name: 'Level', title: 'Level', schema: { type: 'string' } }
    });
    actsigMock.getNodeSignals.mockResolvedValueOnce({
      State: { name: 'State', title: 'Updated State', schema: { type: 'string' } }
    });

    const restartToast = vi.fn();
    element.addEventListener('nodel-toast', restartToast);
    await (element as any).refreshAfterRestart();
    await waitFor(() => Boolean(formByTitle('Level')));

    expect(formByTitle('Power')).toBeNull();
    expect(formByTitle('Updated State')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-actsig-override]')?.checked).toBe(true);
    expect(initialForm.classList.contains('is-pulsing')).toBe(false);
    expect((element as any).pulseTimers.size).toBe(0);
    expect(formByTitle('Level')?.querySelector<HTMLInputElement>('[data-schema-field-input]')?.value).toBe('');
    expect(restartToast).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ id: 'nodel-actsig-refresh-warning' }) }));
    expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(2);
    expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(2);
  });

  it('keeps one subscription and listener set through rapid reconnect loops', async () => {
    const actsig = await mountActSig();
    for (let index = 0; index < 3; index += 1) {
      actsig.remove();
      document.body.append(actsig);
      await waitFor(() => actsigMock.activityListeners.length === index + 2);
    }

    expect(actsigMock.getNodeActions).toHaveBeenCalledTimes(4);
    expect(actsigMock.getNodeSignals).toHaveBeenCalledTimes(4);
    expect(actsigMock.activityListeners).toHaveLength(4);
    expect(actsigMock.activitySubscriptions.filter((subscription) => subscription.active)).toHaveLength(1);
    expect(actsigMock.activitySubscriptions.slice(0, 3).every((subscription) => subscription.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('ignores abort-insensitive definitions from a disconnected generation', async () => {
    let resolveStale!: (value: unknown) => void;
    actsigMock.getNodeActions
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStale = resolve;
      }))
      .mockResolvedValueOnce({ Current: { name: 'Current', title: 'Current', schema: { type: 'boolean' } } });
    const actsig = document.createElement('nodel-actsig');
    document.body.append(actsig);
    await waitFor(() => actsigMock.getNodeActions.mock.calls.length === 1);

    actsig.remove();
    document.body.append(actsig);
    await waitFor(() => formByTitle('Current') !== null);
    resolveStale({ Stale: { name: 'Stale', title: 'Stale', schema: { type: 'boolean' } } });
    await flush();

    expect(formByTitle('Current')).not.toBeNull();
    expect(formByTitle('Stale')).toBeNull();
  });
});
