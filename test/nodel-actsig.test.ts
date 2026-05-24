import { flush, waitFor } from './helpers';

const actsigMock = vi.hoisted(() => ({
  activityListeners: [] as Array<(state: any) => void>,
  callNodeAction: vi.fn(),
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
    return { dispose: vi.fn() };
  })
}));

import '../src/components/nodel-actsig';

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
    actsigMock.callNodeAction.mockReset().mockResolvedValue({});
    actsigMock.emitNodeSignal.mockReset().mockResolvedValue({});
    actsigMock.getNodeActions.mockReset().mockResolvedValue({});
    actsigMock.getNodeSignals.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
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

    const groupedTitles = Array.from(section.querySelectorAll('.nodel-actsig-form h3')).map((heading) => heading.textContent?.trim());
    expect(groupedTitles).toEqual(['Status', 'Volume']);
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
    await setInputValue(form.querySelector<HTMLSelectElement>('select')!, 'On');

    submitForm(form);
    await waitFor(() => actsigMock.callNodeAction.mock.calls.length === 1);

    expect(actsigMock.callNodeAction).toHaveBeenCalledWith('Configure', {
      arg: {
        'ip-address': '192.168.1.10',
        count: 5,
        enabled: true,
        mode: 'On'
      }
    });
  });

  it('keeps signals disabled until override is enabled then emits signal payloads', async () => {
    actsigMock.getNodeSignals.mockResolvedValue({
      Power: { name: 'Power', title: 'Power State', schema: { type: 'boolean' } }
    });

    await mountActSig();
    await waitFor(() => Boolean(formByTitle('Power State')));

    const form = formByTitle('Power State')!;
    expect(form.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);

    submitForm(form);
    await flush();
    expect(actsigMock.emitNodeSignal).not.toHaveBeenCalled();

    await setCheckboxValue(document.querySelector<HTMLInputElement>('[data-actsig-override]')!, true);
    await waitFor(() => form.querySelector<HTMLFieldSetElement>('fieldset')?.disabled === false);

    await setCheckboxValue(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!, true);
    submitForm(form);
    await waitFor(() => actsigMock.emitNodeSignal.mock.calls.length === 1);

    expect(actsigMock.emitNodeSignal).toHaveBeenCalledWith('Power', { arg: true });
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
});
