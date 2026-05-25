import { flush, waitFor } from './helpers';

const bindingsMock = vi.hoisted(() => ({
  getNodeRemoteBindings: vi.fn(),
  getNodeRemoteSchema: vi.fn(),
  getRemoteNodeActions: vi.fn(),
  getRemoteNodeSignals: vi.fn(),
  saveNodeRemoteBindings: vi.fn(),
  searchNodeUrls: vi.fn()
}));

const activityMock = vi.hoisted(() => ({
  listener: null as null | ((state: any) => void),
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listener = listener;
    listener({ loading: false, connected: true, error: '', batch: null });
    return { dispose: vi.fn(), refresh: vi.fn() };
  })
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeRemoteBindings: bindingsMock.getNodeRemoteBindings,
  getNodeRemoteSchema: bindingsMock.getNodeRemoteSchema,
  getRemoteNodeActions: bindingsMock.getRemoteNodeActions,
  getRemoteNodeSignals: bindingsMock.getRemoteNodeSignals,
  saveNodeRemoteBindings: bindingsMock.saveNodeRemoteBindings,
  searchNodeUrls: bindingsMock.searchNodeUrls
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: activityMock.subscribeNodeActivity
}));

import '../src/components/nodel-bindings';

const bindingSchema = {
  type: 'object',
  properties: {
    actions: {
      type: 'object',
      properties: {
        setLevel: { type: 'object', title: 'Set Level', desc: 'Set target level' },
        powerOn: { type: 'object', title: 'Power On' }
      }
    },
    events: {
      type: 'object',
      properties: {
        statusChanged: { type: 'object', title: 'Status Changed' }
      }
    }
  }
};

async function mountBindings() {
  document.body.innerHTML = '<nodel-bindings></nodel-bindings>';
  await customElements.whenDefined('nodel-bindings');
  await waitFor(() => bindingsMock.getNodeRemoteSchema.mock.calls.length === 1 && bindingsMock.getNodeRemoteBindings.mock.calls.length === 1, {
    attempts: 100,
    intervalMs: 1
  });
  await waitFor(() => !document.body.textContent?.includes('Loading bindings'), {
    attempts: 100,
    intervalMs: 1
  });
  await flush();
  return document.querySelector('nodel-bindings')!;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

function submitForm() {
  document.querySelector<HTMLFormElement>('[data-bindings-form]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function section(kind: 'actions' | 'events') {
  return document.querySelector<HTMLElement>(`[data-bindings-section="${kind}"]`)!;
}

function rows(kind: 'actions' | 'events') {
  return Array.from(section(kind).querySelectorAll<HTMLElement>('[data-bindings-row-id]'));
}

function rowInputs(row: HTMLElement) {
  return {
    select: row.querySelector<HTMLInputElement>('[data-bindings-row-select]')!,
    node: row.querySelector<HTMLInputElement>('[data-bindings-node]')!,
    target: row.querySelector<HTMLInputElement>('[data-bindings-target]')!
  };
}

async function selectRow(row: HTMLElement) {
  const checkbox = rowInputs(row).select;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

describe('nodel-bindings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    activityMock.listener = null;
    activityMock.subscribeNodeActivity.mockClear();
    bindingsMock.getNodeRemoteSchema.mockReset().mockResolvedValue({ type: 'object', properties: {} });
    bindingsMock.getNodeRemoteBindings.mockReset().mockResolvedValue({});
    bindingsMock.getRemoteNodeActions.mockReset().mockResolvedValue({});
    bindingsMock.getRemoteNodeSignals.mockReset().mockResolvedValue({});
    bindingsMock.saveNodeRemoteBindings.mockReset().mockResolvedValue({});
    bindingsMock.searchNodeUrls.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads schema and current values, renders actions and events, and saves raw payloads', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: {
        setLevel: { node: 'Lighting', action: 'Dim' },
        powerOn: { node: 'Lighting', action: 'On' }
      },
      events: {
        statusChanged: { node: 'Sensor', event: 'Status' }
      }
    });

    await mountBindings();

    expect(document.body.textContent).toContain('Actions');
    expect(document.body.textContent).toContain('Events');
    expect(document.body.textContent).toContain('Set Level');
    expect(document.body.textContent).toContain('Status Changed');

    const firstAction = rows('actions')[0];
    await setInputValue(rowInputs(firstAction).target, 'SetDim');

    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);

    expect(bindingsMock.saveNodeRemoteBindings).toHaveBeenCalledWith({
      actions: {
        setLevel: { node: 'Lighting', action: 'SetDim' },
        powerOn: { node: 'Lighting', action: 'On' }
      },
      events: {
        statusChanged: { node: 'Sensor', event: 'Status' }
      }
    });
    expect(document.body.textContent).toContain('Saved');
  });

  it('renders an empty state when there are no binding schema fields', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({ type: 'object', properties: {} });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({});

    await mountBindings();

    expect(document.body.textContent).toContain('No bindings.');
    submitForm();
    await flush();
    expect(bindingsMock.saveNodeRemoteBindings).not.toHaveBeenCalled();
  });

  it('renders load and save errors', async () => {
    bindingsMock.getNodeRemoteSchema.mockRejectedValueOnce(new Error('Remote schema unavailable'));
    bindingsMock.getNodeRemoteBindings.mockResolvedValueOnce({});

    await mountBindings();

    expect(document.body.textContent).toContain('Remote schema unavailable');
    expect(document.body.textContent).not.toContain('No bindings.');

    bindingsMock.getNodeRemoteSchema.mockResolvedValueOnce(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValueOnce({
      actions: { setLevel: { node: 'Lighting', action: 'Dim' } },
      events: {}
    });
    bindingsMock.saveNodeRemoteBindings.mockRejectedValueOnce(new Error('Save failed'));

    await mountBindings();
    submitForm();
    await waitFor(() => document.body.textContent?.includes('Save failed'));

    expect(bindingsMock.saveNodeRemoteBindings).toHaveBeenCalled();
  });

  it('uses node autocomplete and fills the selected row node', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);

    await mountBindings();

    const firstAction = rows('actions')[0];
    await setInputValue(rowInputs(firstAction).node, 'Light');
    await waitFor(() => bindingsMock.searchNodeUrls.mock.calls.length > 0);
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);

    firstAction.querySelector<HTMLButtonElement>('[data-bindings-option="node"]')?.click();
    await flush();

    expect(rowInputs(firstAction).node.value).toBe('Lighting');
  });

  it('uses action/event autocomplete from the selected target node', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockResolvedValue({
      dim: { name: 'dim', title: 'Dim Level', group: 'Lighting' }
    });

    await mountBindings();

    const firstAction = rows('actions')[0];
    await setInputValue(rowInputs(firstAction).target, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);
    await waitFor(() => rows('actions')[0].querySelectorAll('[data-bindings-option="target"]').length === 1);

    const liveFirstAction = rows('actions')[0];
    liveFirstAction.querySelector<HTMLButtonElement>('[data-bindings-option="target"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledWith('http://host/nodes/Lighting/');
    expect(rowInputs(rows('actions')[0]).target.value).toBe('dim');
  });

  it('bulk sets node only for selected rows', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });

    await mountBindings();

    const [firstAction, secondAction] = rows('actions');
    await selectRow(firstAction);
    await setInputValue(document.querySelector<HTMLInputElement>('[data-bindings-bulk-node]')!, 'Lighting');
    document.querySelector<HTMLButtonElement>('[data-bindings-apply-node]')?.click();
    await flush();

    expect(rowInputs(firstAction).node.value).toBe('Lighting');
    expect(rowInputs(secondAction).node.value).toBe('');
  });

  it('uses one shared toolbar and closes the bulk node dropdown on blur', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: { statusChanged: {} } });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);

    await mountBindings();

    expect(document.querySelectorAll('.nodel-bindings-toolbar-panel').length).toBe(1);
    expect(document.querySelector<HTMLInputElement>('[data-bindings-bulk-node]')?.placeholder).toBe('Search node');

    const bulkNode = document.querySelector<HTMLInputElement>('[data-bindings-bulk-node]')!;
    await setInputValue(bulkNode, 'Light');
    await waitFor(() => document.querySelectorAll('[data-bindings-option="bulk-node"]').length === 1);

    bulkNode.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    await flush();

    expect(document.querySelectorAll('[data-bindings-option="bulk-node"]').length).toBe(0);
  });

  it('clears the shared filter from the search control and clear button', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: { statusChanged: {} } });

    await mountBindings();

    const filter = document.querySelector<HTMLInputElement>('[data-bindings-filter]')!;
    await setInputValue(filter, 'power');
    await waitFor(() => rows('actions').length === 1);
    expect(rows('actions')[0].textContent).toContain('Power On');

    filter.value = '';
    filter.dispatchEvent(new Event('search'));
    await waitFor(() => rows('actions').length === 2);

    await setInputValue(filter, 'status');
    await waitFor(() => rows('events').length === 1 && rows('actions').length === 0);

    document.querySelector<HTMLButtonElement>('[data-bindings-clear-filter]')?.click();
    await waitFor(() => rows('actions').length === 2 && rows('events').length === 1);
    expect(filter.value).toBe('');
  });

  it('suggests matches and applies high or medium confidence suggestions for selected rows', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting' }, powerOn: { node: 'Lighting' } }, events: {} });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockResolvedValue({
      setLevel: { name: 'setLevel', title: 'Set Level' },
      powerOn: { name: 'powerOn', title: 'Power On' }
    });

    await mountBindings();

    document.querySelector<HTMLButtonElement>('[data-bindings-select="visible"]')?.click();
    await flush();
    document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.click();
    await waitFor(() => document.body.textContent?.includes('2 suggestions ready.'));

    document.querySelector<HTMLButtonElement>('[data-bindings-apply-suggestions]')?.click();
    await flush();

    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);

    expect(bindingsMock.saveNodeRemoteBindings.mock.calls[0][0].actions).toEqual({
      setLevel: { node: 'Lighting', action: 'setLevel' },
      powerOn: { node: 'Lighting', action: 'powerOn' }
    });
  });

  it('updates row status from remote binding activity entries', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });

    await mountBindings();

    activityMock.listener?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          {
            changed: true,
            live: false,
            entry: {
              seq: 1,
              timestamp: '2026-05-25T00:00:00Z',
              source: 'remote',
              type: 'actionBinding',
              alias: 'setLevel',
              arg: 'Wired'
            }
          }
        ]
      }
    });
    await flush();

    expect(rows('actions')[0].textContent).toContain('Wired');
  });

  it('normalizes non-wired backend binding states to Unwired', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: { statusChanged: {} } });

    await mountBindings();

    activityMock.listener?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 3,
        items: [
          {
            changed: true,
            live: false,
            entry: {
              seq: 2,
              timestamp: '2026-05-25T00:00:00Z',
              source: 'remote',
              type: 'actionBinding',
              alias: 'setLevel',
              arg: 'Empty'
            }
          }
        ]
      }
    });
    await flush();

    expect(rows('actions')[0].textContent).toContain('Unwired');
    expect(rows('actions')[0].textContent).not.toContain('Empty');
  });
});
