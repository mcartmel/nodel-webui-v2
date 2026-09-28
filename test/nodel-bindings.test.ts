import { flush, flushMicrotasks, waitFor } from './helpers';
import { deferred } from './lifecycle-helpers';
import type { NodeRestartRefreshResult } from '../src/data/node-restart-source';
import type {
  NodelActionDefinition,
  NodelActivityLogEntry,
  NodelJsonSchema,
  NodelLocalRestResponse,
  NodelNodeUrlEntry,
  NodelRemoteBindings,
  NodelSignalDefinition
} from '../src/api/nodel-types';
import type { NodelBindings } from '../src/components/nodel-bindings';

type BindingActivityBatch = {
  items: Array<{ changed: boolean; live: boolean; entry: NodelActivityLogEntry }>;
  replace: boolean;
  transport: 'websocket' | 'poll' | null;
  nextSeq: number;
};

type BindingActivityState = {
  loading: boolean;
  connected: boolean;
  error: string;
  batch: BindingActivityBatch | null;
};

type ActivitySubscriber = {
  listener: ((state: BindingActivityState) => void) | null;
  subscribeNodeActivity: ReturnType<typeof vi.fn>;
};

const bindingsMock = vi.hoisted(() => ({
  getLocalRest: vi.fn<(options?: RequestInit) => Promise<NodelLocalRestResponse>>(),
  getNodeRemoteBindings: vi.fn<(options?: RequestInit) => Promise<NodelRemoteBindings>>(),
  getNodeRemoteSchema: vi.fn<(options?: RequestInit) => Promise<NodelJsonSchema>>(),
  getRemoteNodeActions: vi.fn<(nodeUrl: string, options?: RequestInit) => Promise<Record<string, NodelActionDefinition>>>(),
  getRemoteNodeSignals: vi.fn<(nodeUrl: string, options?: RequestInit) => Promise<Record<string, NodelSignalDefinition>>>(),
  getNodeUrlsForNode: vi.fn<(name: string, options?: RequestInit) => Promise<NodelNodeUrlEntry[]>>(),
  saveNodeRemoteBindings: vi.fn<(payload: Record<string, unknown>, options?: RequestInit) => Promise<unknown>>(),
  searchNodeUrls: vi.fn<(filter: string, options?: RequestInit) => Promise<NodelNodeUrlEntry[]>>()
}));

const activityMock = vi.hoisted(() => {
  const subscribeNodeActivity: ActivitySubscriber['subscribeNodeActivity'] = vi.fn((
    _element: HTMLElement,
    listener: (state: BindingActivityState) => void
  ) => {
    state.listener = listener;
    listener({ loading: false, connected: true, error: '', batch: null });
    return { dispose: vi.fn(), refresh: vi.fn() };
  });

  const state: ActivitySubscriber = { listener: null, subscribeNodeActivity };

  return state;
});

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

type RefreshableBindingsElement = NodelBindings & {
  refreshAfterRestart(): Promise<NodeRestartRefreshResult>;
};

type BindingsInternalState = {
  busy: boolean;
  message: string;
};

function failOnMissing(message: string): never {
  throw new Error(message);
}

function assertDefined<T>(value: T | undefined | null, message: string): Exclude<T, undefined | null> {
  if (value === undefined || value === null) {
    failOnMissing(message);
  }

  return value as Exclude<T, undefined | null>;
}

function queryRequired<T extends Element>(selector: string, context: ParentNode = document): T {
  const element = context.querySelector(selector);
  return assertDefined(element as T | null, `Expected element ${selector} to exist`);
}

function rowAt(kind: 'actions' | 'events', index: number, label: string): HTMLElement {
  const list = rows(kind);
  const row = list[index];
  return assertDefined(row, `Expected ${label} ${kind} row at index ${index}`);
}

function callAt<T extends readonly unknown[]>(calls: T[], label: string, index = 0): T {
  const call = calls[index];
  return assertDefined(call, `Expected ${label} call at index ${index}`);
}

function requireBindingsState(element: NodelBindings): BindingsInternalState {
  const value = (element as unknown as { state?: BindingsInternalState }).state;
  return assertDefined(value, 'Expected nodel-bindings state to be present');
}

function requireRefreshableBindings(element: HTMLElement): RefreshableBindingsElement {
  const casted = element as unknown as RefreshableBindingsElement;
  const refresh = casted.refreshAfterRestart;
  if (typeof refresh !== 'function') {
    failOnMissing('Expected nodel-bindings element to expose refreshAfterRestart');
  }
  return casted;
}

function requireAbortSignal(signal: AbortSignal | null, message: string): AbortSignal {
  if (signal === null) {
    failOnMissing(message);
  }

  return signal;
}

function queryInput(selector: string, context: ParentNode = document): HTMLInputElement {
  return queryRequired<HTMLInputElement>(selector, context);
}

vi.mock('../src/api/nodel-host-client', () => ({
  getLocalRest: bindingsMock.getLocalRest,
  getNodeRemoteBindings: bindingsMock.getNodeRemoteBindings,
  getNodeRemoteSchema: bindingsMock.getNodeRemoteSchema,
  getRemoteNodeActions: bindingsMock.getRemoteNodeActions,
  getRemoteNodeSignals: bindingsMock.getRemoteNodeSignals,
  saveNodeRemoteBindings: bindingsMock.saveNodeRemoteBindings,
  searchNodeUrls: bindingsMock.searchNodeUrls,
  getNodeUrlsForNode: bindingsMock.getNodeUrlsForNode
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: activityMock.subscribeNodeActivity
}));

import '../src/components/nodel-bindings';

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
  return queryRequired<NodelBindings>('nodel-bindings');
}

async function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

async function pressKey(input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await flush();
}

function submitForm() {
  queryRequired<HTMLFormElement>('[data-bindings-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function section(kind: 'actions' | 'events') {
  return queryRequired<HTMLElement>(`[data-bindings-section="${kind}"]`);
}

function rows(kind: 'actions' | 'events') {
  return Array.from(section(kind).querySelectorAll<HTMLElement>('[data-bindings-row-id]'));
}

function rowInputs(row: HTMLElement) {
  return {
    select: queryRequired<HTMLInputElement>('[data-bindings-row-select]', row),
    node: queryRequired<HTMLInputElement>('[data-bindings-node]', row),
    target: queryRequired<HTMLInputElement>('[data-bindings-target]', row)
  };
}

async function selectRow(row: HTMLElement) {
  const checkbox = rowInputs(row).select;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  expect(checkbox.checked).toBe(true);
}

describe('nodel-bindings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    activityMock.listener = null;
    activityMock.subscribeNodeActivity.mockClear();
    bindingsMock.getNodeRemoteSchema.mockReset().mockResolvedValue({ type: 'object', properties: {} });
    bindingsMock.getNodeRemoteBindings.mockReset().mockResolvedValue({});
    bindingsMock.getLocalRest.mockReset().mockResolvedValue({ nodes: {} });
    bindingsMock.getRemoteNodeActions.mockReset().mockResolvedValue({});
    bindingsMock.getRemoteNodeSignals.mockReset().mockResolvedValue({});
    bindingsMock.saveNodeRemoteBindings.mockReset().mockResolvedValue({});
    bindingsMock.searchNodeUrls.mockReset().mockResolvedValue([]);
    bindingsMock.getNodeUrlsForNode.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
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

    const bindingsForm = queryRequired<HTMLFormElement>('[data-bindings-form]');
    const bindingsFieldset = queryRequired<HTMLFieldSetElement>('fieldset', bindingsForm);
    const sections = assertDefined(section('actions').parentElement, 'Expected actions section container to have parent');
    const sectionContent = queryRequired<HTMLElement>('.nodel-bindings-collapse-body', section('actions'));
    expect(bindingsForm.classList.contains('space-y-3')).toBe(false);
    expect(bindingsForm.classList.contains('gap-3')).toBe(true);
    expect(bindingsFieldset.classList.contains('gap-3')).toBe(true);
    expect(sections.classList.contains('space-y-3')).toBe(false);
    expect(sections.classList.contains('gap-3')).toBe(true);
    expect(sectionContent.classList.contains('space-y-2.5')).toBe(false);
    expect(sectionContent.classList.contains('gap-2.5')).toBe(true);
    const compactActions = Array.from(document.querySelectorAll<HTMLElement>('.nodel-bindings-toolbar-panel button, [data-bindings-save], [data-bindings-revert], [data-bindings-show-invalid]'));
    expect(compactActions.length).toBeGreaterThan(0);
    for (const action of compactActions) {
      expect(action.classList.contains('nodel-button-compact')).toBe(true);
      expect(action.classList.contains('h-11') || action.classList.contains('min-h-11')).toBe(false);
    }
    expect(queryInput('[data-bindings-filter]').classList.contains('nodel-field-compact')).toBe(true);
    expect(queryRequired<HTMLSelectElement>('[data-bindings-status-filter]').classList.contains('nodel-field-compact')).toBe(true);
    const metadata = queryRequired<HTMLElement>('.nodel-bindings-meta');
    expect(metadata.closest('.nodel-bindings-filter-toolbar')).toBeNull();
    expect(metadata.querySelector('[aria-live="polite"]')?.textContent).toContain('3 bindings');
    expect(metadata.querySelector('[aria-live="polite"]')?.textContent).not.toContain('selected');
    expect(document.querySelector('.nodel-bindings-help')).toBeNull();
    expect(document.body.textContent).not.toContain('Selection replaces checked rows within results');
    expect(document.body.textContent).toContain('Actions');
    expect(document.body.textContent).toContain('Events');
    expect(document.body.textContent).toContain('Set Level');
    expect(document.body.textContent).toContain('Status Changed');

    const firstAction = rowAt('actions', 0, 'first');
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
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.body.textContent).toContain('Saved');
  });

  it('enables Select Unset from saved status without runtime evidence and honors current filters', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: { node: 'Lighting', action: 'On' } }, events: {} });
    await mountBindings();
    const selectUnset = queryRequired<HTMLButtonElement>('[data-bindings-select="unset"]');
    expect(selectUnset.disabled).toBe(false);
    expect(queryRequired<HTMLElement>('[data-bindings-row-id]', section('actions')).getAttribute('data-bindings-row-id')).toBeTruthy();
    await setInputValue(rowInputs(rowAt('actions', 0, 'Unset')).target, 'Draft target');
    expect(rowAt('actions', 0, 'edited Unset').textContent).toContain('Unset');
    selectUnset.click();
    await flush();
    expect(queryRequired<HTMLInputElement>('[data-bindings-row-select]', rowAt('actions', 0, 'selected Unset')).checked).toBe(true);
    const status = queryRequired<HTMLSelectElement>('[data-bindings-status-filter]');
    status.value = 'Unwired';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(selectUnset.disabled).toBe(true);
    expect(rows('actions')).toHaveLength(0);
  });

  it('saves complete, partial, and empty rows while preserving unknown binding metadata', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            complete: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', required: true }
              }
            },
            nodeOnly: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', required: true }
              }
            },
            targetOnly: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', required: true }
              }
            },
            empty: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', required: true }
              }
            }
          }
        }
      }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      rootMetadata: { keep: true },
      actions: {
        sectionMetadata: 'keep',
        complete: { node: 'Lighting', action: 'Dim' },
        nodeOnly: { node: 'Lighting', rowMetadata: 7 },
        targetOnly: { action: 'Dim' },
        empty: {}
      }
    });

    await mountBindings();
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);
    expect(callAt(bindingsMock.saveNodeRemoteBindings.mock.calls, 'saveNodeRemoteBindings call')[0]).toEqual({
      rootMetadata: { keep: true },
      actions: {
        sectionMetadata: 'keep',
        complete: { node: 'Lighting', action: 'Dim' },
        nodeOnly: { node: 'Lighting', rowMetadata: 7 },
        targetOnly: { action: 'Dim' },
        empty: {}
      }
    });
    expect(document.body.textContent).not.toContain('required');
  });

  it('allows Java-declared empty binding rows while retaining required schema flags', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            unbound: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', required: true }
              }
            }
          }
        }
      }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { unbound: {} } });

    await mountBindings();
    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);
    expect(callAt(bindingsMock.saveNodeRemoteBindings.mock.calls, 'saveNodeRemoteBindings call')[0]).toEqual({ actions: { unbound: {} } });
  });

  it('does not manufacture untouched schema rows missing from a replacement payload', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      rootMetadata: { keep: true },
      actions: {
        sectionMetadata: { keep: true },
        setLevel: { node: 'Lighting', action: 'Dim', rowMetadata: 4 }
      }
    });

    await mountBindings();
    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);

    expect(callAt(bindingsMock.saveNodeRemoteBindings.mock.calls, 'saveNodeRemoteBindings call')[0]).toEqual({
      rootMetadata: { keep: true },
      actions: {
        sectionMetadata: { keep: true },
        setLevel: { node: 'Lighting', action: 'Dim', rowMetadata: 4 }
      }
    });
  });

  it('blocks writes for an unsupported remote schema instead of rendering a partial editor', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({ ...bindingSchema, pattern: 'unsupported' });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } } });

    await mountBindings();
    submitForm();
    await flush();
    expect(document.body.textContent).toContain('Unsupported binding schema');
    expect(bindingsMock.saveNodeRemoteBindings).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-bindings-row-id]')).toHaveLength(0);
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

  it('refreshes remote schema and binding values after a node restart', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValueOnce(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValueOnce({
      actions: {
        setLevel: { node: 'Lighting', action: 'Dim' },
        powerOn: { node: 'Lighting', action: 'On' }
      },
      events: {
        statusChanged: { node: 'Sensor', event: 'Status' }
      }
    });

    const element = await mountBindings();
    expect(document.body.textContent).toContain('Set Level');

    bindingsMock.getNodeRemoteSchema.mockResolvedValueOnce({
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            newAction: { type: 'object', title: 'New Action' }
          }
        }
      }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValueOnce({
      actions: {
        newAction: { node: 'Projector', action: 'Start' }
      }
    });

    await requireRefreshableBindings(element).refreshAfterRestart();
    await waitFor(() => document.body.textContent?.includes('New Action'));

    expect(document.body.textContent).not.toContain('Set Level');
    expect(bindingsMock.getNodeRemoteSchema).toHaveBeenCalledTimes(2);
    expect(bindingsMock.getNodeRemoteBindings).toHaveBeenCalledTimes(2);
  });

  it('resets disclosure preferences only after a current clean restart load', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } }, events: { statusChanged: { node: 'Sensor', event: 'Status' } } });
    const element = await mountBindings();
    expect(section('actions').hasAttribute('open')).toBe(true);
    expect(section('events').hasAttribute('open')).toBe(true);
    await setInputValue(queryInput('[data-bindings-filter]'), 'Level');
    queryRequired<HTMLDetailsElement>('details', section('actions')).open = false;
    await waitFor(() => !section('actions').hasAttribute('open'));
    const result = await requireRefreshableBindings(element).refreshAfterRestart();
    expect(result.status).toBe('verified');
    expect(section('actions').hasAttribute('open')).toBe(true);
    expect(section('events').hasAttribute('open')).toBe(true);
    await setInputValue(queryInput('[data-bindings-filter]'), 'Level');
    await setInputValue(queryInput('[data-bindings-filter]'), '');
    expect(section('actions').hasAttribute('open')).toBe(true);
    expect(section('events').hasAttribute('open')).toBe(true);
  });

  it('preserves dirty binding drafts and invalidates saved runtime status on restart', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } } });
    const element = await mountBindings();
    const row = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(row).target, 'SetDim');
    const calls = bindingsMock.getNodeRemoteBindings.mock.calls.length;

    const result = await requireRefreshableBindings(element).refreshAfterRestart();

    expect(result).toMatchObject({ status: 'dirty-preserved' });
    expect(rowInputs(row).target.value).toBe('SetDim');
    expect(element.textContent).toContain('bindings were not reloaded');
    expect(bindingsMock.getNodeRemoteBindings).toHaveBeenCalledTimes(calls);
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

  it('reports a failed restart refresh while preserving the bindings error', async () => {
    const element = await mountBindings();
    bindingsMock.getNodeRemoteSchema.mockRejectedValueOnce(new Error('Restart bindings unavailable'));
    bindingsMock.getNodeRemoteBindings.mockResolvedValueOnce({});

    const result = await requireRefreshableBindings(element).refreshAfterRestart();

    expect(result).toMatchObject({ status: 'failed', detail: 'Restart bindings unavailable' });
    expect(element.textContent).toContain('Restart bindings unavailable');
  });

  it('uses node autocomplete and fills the selected row node', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);
    bindingsMock.getNodeUrlsForNode.mockResolvedValue([
      { node: 'Lighting', address: `${window.location.origin}/nodes/Lighting/`, host: 'local' }
    ]);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).node, 'Light');
    await waitFor(() => bindingsMock.searchNodeUrls.mock.calls.length > 0);
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);

    const nodeOption = queryRequired<HTMLButtonElement>('[data-bindings-option="node"]', firstAction);
    const nodeMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    nodeOption.dispatchEvent(nodeMouseDown);
    expect(nodeMouseDown.defaultPrevented).toBe(true);
    nodeOption.click();
    await flush();

    expect(rowInputs(firstAction).node.value).toBe('Lighting');
    expect(firstAction.querySelector('.nodel-bindings-popover')).toBeNull();
    await waitFor(() => firstAction.querySelector<HTMLAnchorElement>('[data-bindings-open-node]')?.href === `${window.location.origin}/nodes/Lighting/`);
  });

  it('surfaces node lookup failures instead of presenting them as no matches', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockRejectedValue(new Error('Node lookup failed'));
    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).node, 'Light');
    await waitFor(() => document.body.textContent?.includes('Node lookup failed'));

    expect(document.querySelector('.nodel-alert-danger')?.textContent).toContain('Node lookup failed');
  });

  it('selects a row node autocomplete option with the keyboard', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const nodeInput = rowInputs(firstAction).node;
    await setInputValue(nodeInput, 'Light');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);

    await pressKey(nodeInput, 'ArrowDown');
    expect(firstAction.querySelector('[data-bindings-option="node"]')?.classList.contains('nodel-menu-item-active')).toBe(true);
    await pressKey(nodeInput, 'Enter');

    expect(rowInputs(firstAction).node.value).toBe('Lighting');
    expect(firstAction.querySelector('.nodel-bindings-popover')).toBeNull();
  });

  it('does not reopen the node dropdown from stale autocomplete responses after selection', async () => {
    const pendingSearch = deferred<NodelNodeUrlEntry[]>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls
      .mockResolvedValueOnce([{ node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }])
      .mockReturnValueOnce(pendingSearch.promise);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const nodeInput = rowInputs(firstAction).node;
    await setInputValue(nodeInput, 'Light');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);

    await setInputValue(nodeInput, 'Lighti');
    firstAction.querySelector<HTMLButtonElement>('[data-bindings-option="node"]')?.click();
    await flush();
    pendingSearch.resolve([{ node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }]);
    await flush();

    expect(rowInputs(firstAction).node.value).toBe('Lighting');
    expect(firstAction.querySelector('.nodel-bindings-popover')).toBeNull();
  });

  it('keeps row node autocomplete lookups independent', async () => {
    const firstSearch = deferred<NodelNodeUrlEntry[]>();
    const secondSearch = deferred<NodelNodeUrlEntry[]>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const secondAction = rowAt('actions', 1, 'second');
    await setInputValue(rowInputs(firstAction).node, 'Light');
    expect(rowInputs(firstAction).node.getAttribute('aria-busy')).toBe('true');
    await setInputValue(rowInputs(secondAction).node, 'Projector');

    secondSearch.resolve([{ node: 'Projector', address: 'http://host/nodes/Projector/', host: 'host' }]);
    await waitFor(() => secondAction.querySelectorAll('[data-bindings-option="node"]').length === 1);
    firstSearch.resolve([{ node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }]);
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);

    expect(firstAction.querySelector('[data-bindings-option="node"]')?.textContent).toContain('Lighting');
    expect(secondAction.querySelector('[data-bindings-option="node"]')?.textContent).toContain('Projector');
    expect(rowInputs(firstAction).node.getAttribute('aria-busy')).toBe('false');
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

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).target, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="target"]').length === 1);

    const targetOption = queryRequired<HTMLButtonElement>('[data-bindings-option="target"]', firstAction);
    const targetMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    targetOption.dispatchEvent(targetMouseDown);
    expect(targetMouseDown.defaultPrevented).toBe(true);
    targetOption.click();
    await flush();

    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledWith('http://host/nodes/Lighting/', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(rowInputs(firstAction).target.value).toBe('dim');
    expect(firstAction.querySelector('.nodel-bindings-popover')).toBeNull();
  });

  it('aborts target definition requests when lookup timeout elapses', async () => {
    let targetSignal: AbortSignal | null = null;
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} }, events: {} });
    bindingsMock.getLocalRest.mockResolvedValue({ nodes: { Lighting: { name: 'Lighting' } } });
    bindingsMock.getRemoteNodeActions.mockImplementation((_url: string, init?: RequestInit) => {
      targetSignal = init?.signal ?? null;
      return new Promise((_resolve, reject) => {
        targetSignal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });

    await mountBindings();
    const firstAction = rowAt('actions', 0, 'first');
    const targetInput = rowInputs(firstAction).target;
    await flushMicrotasks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    targetInput.value = 'Dim';
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 20; i += 1) {
      await flushMicrotasks();
    }
    expect(targetSignal).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2999);
    expect(requireAbortSignal(targetSignal, 'Expected target request signal to be set').aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    await flushMicrotasks();

    const targetRequestSignal = requireAbortSignal(targetSignal, 'Expected target request signal to be set');
    expect(targetRequestSignal.aborted).toBe(true);
    expect(document.body.textContent).toContain('Request timed out after 3000 ms');
  }, 7000);

  it('selects a row target autocomplete option with the keyboard', async () => {
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

    const firstAction = rowAt('actions', 0, 'first');
    const targetInput = rowInputs(firstAction).target;
    await setInputValue(targetInput, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="target"]').length === 1);

    await pressKey(rowInputs(firstAction).target, 'ArrowDown');
    await pressKey(rowInputs(firstAction).target, 'Enter');

    expect(rowInputs(firstAction).target.value).toBe('dim');
    expect(firstAction.querySelector('.nodel-bindings-popover')).toBeNull();
  });

  it('uses same-origin local node URLs for target lookup before advertised URLs', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.getLocalRest.mockResolvedValue({ nodes: { Lighting: { name: 'Lighting' } } });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://lan-host/nodes/Lighting/', host: 'lan-host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockImplementation(async (url: string) => {
      if (url === `${window.location.origin}/nodes/Lighting/`) {
        return { dim: { name: 'dim', title: 'Dim Level', group: 'Lighting' } };
      }
      throw new Error('Advertised URL should not be used for local lookup');
    });

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const targetInput = rowInputs(firstAction).target;
    await setInputValue(targetInput, 'Dim');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="target"]').length === 1);

    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledWith(`${window.location.origin}/nodes/Lighting/`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(bindingsMock.searchNodeUrls).not.toHaveBeenCalled();
    expect(firstAction.textContent).toContain('Dim Level');
  });

  it('prefers same-origin local lookup even after a selected advertised node URL', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.getLocalRest.mockResolvedValue({ nodes: { Lighting: { name: 'Lighting' } } });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://lan-host/nodes/Lighting/', host: 'lan-host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockImplementation(async (url: string) => {
      if (url === `${window.location.origin}/nodes/Lighting/`) {
        return { dim: { name: 'dim', title: 'Dim Level' } };
      }
      throw new Error('LAN address is unreachable from this browser');
    });

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).node, 'Light');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);
    firstAction.querySelector<HTMLButtonElement>('[data-bindings-option="node"]')?.click();
    await flush();

    await setInputValue(rowInputs(firstAction).target, 'Dim');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="target"]').length === 1);

    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledWith(`${window.location.origin}/nodes/Lighting/`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(bindingsMock.getRemoteNodeActions).not.toHaveBeenCalledWith('http://lan-host/nodes/Lighting/', expect.anything());
  });

  it('tries multiple discovered URLs and uses the reachable one for non-local target lookup', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://bad-host/nodes/Lighting/', host: 'bad-host' },
      { node: 'Lighting', address: 'http://good-host/nodes/Lighting/', host: 'good-host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockImplementation(async (url: string) => {
      if (url === 'http://good-host/nodes/Lighting/') {
        return { dim: { name: 'dim', title: 'Dim Level' } };
      }
      throw new Error('unreachable');
    });

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).target, 'Dim');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="target"]').length === 1);

    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledWith('http://bad-host/nodes/Lighting/', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledWith('http://good-host/nodes/Lighting/', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(rowInputs(firstAction).target.value).toBe('Dim');
    expect(firstAction.textContent).toContain('Dim Level');
  });

  it('merges definitions from multiple successful discovered URLs without duplicate names', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://first-host/nodes/Lighting/', host: 'first-host' },
      { node: 'Lighting', address: 'http://second-host/nodes/Lighting/', host: 'second-host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockImplementation(async (url: string) => {
      if (url === 'http://first-host/nodes/Lighting/') {
        return {
          dim: { name: 'dim', title: 'Dim Level' },
          on: { name: 'on', title: 'Power On' }
        };
      }
      return {
        dim: { name: 'dim', title: 'Duplicate Dim' },
        off: { name: 'off', title: 'Power Off' }
      };
    });

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).target, '');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="target"]').length === 3);

    const options = Array
      .from(firstAction.querySelectorAll<HTMLButtonElement>('[data-bindings-option="target"]'))
      .map((option) => option.textContent ?? '');
    expect(options.join(' ')).toContain('Dim Level');
    expect(options.join(' ')).not.toContain('Duplicate Dim');
    expect(options.join(' ')).toContain('Power On');
    expect(options.join(' ')).toContain('Power Off');
  });

  it('reuses target lookup results within the TTL and refreshes after expiry', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);
    bindingsMock.getRemoteNodeActions.mockResolvedValue({
      dim: { name: 'dim', title: 'Dim Level' }
    });

    await mountBindings();

    const targetInput = rowInputs(rowAt('actions', 0, 'first')).target;
    await setInputValue(targetInput, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);

    nowSpy.mockReturnValue(1000 + 10_000);
    await setInputValue(targetInput, 'Di');
    await flush();
    expect(bindingsMock.getRemoteNodeActions).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1000 + 31_000);
    await setInputValue(targetInput, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 2);
  });

  it('does not include selected node URLs in the saved binding payload', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    await setInputValue(rowInputs(firstAction).node, 'Light');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);
    firstAction.querySelector<HTMLButtonElement>('[data-bindings-option="node"]')?.click();
    await flush();

    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);

    const saveCall = callAt(bindingsMock.saveNodeRemoteBindings.mock.calls, 'saveNodeRemoteBindings call')[0] as NodelRemoteBindings;
    expect(assertDefined(saveCall.actions, 'Expected actions payload to be present').setLevel).toEqual({
      node: 'Lighting'
    });
  });

  it('bulk sets node only for selected rows', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const secondAction = rowAt('actions', 1, 'second');
    await selectRow(firstAction);
    await setInputValue(queryInput('[data-bindings-bulk-node]'), 'Lighting');
    document.querySelector<HTMLButtonElement>('[data-bindings-apply-node]')?.click();
    await flush();

    expect(rowInputs(firstAction).node.value).toBe('Lighting');
    expect(rowInputs(secondAction).node.value).toBe('');
  });

  it('saves a node-only row after bulk setting without revealing a target error', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            setLevel: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', required: true }
              }
            }
          }
        }
      }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {} } });

    await mountBindings();

    const actionRow = rowAt('actions', 0, 'first');
    await selectRow(actionRow);
    await setInputValue(queryInput('[data-bindings-bulk-node]'), 'Lighting');
    document.querySelector<HTMLButtonElement>('[data-bindings-apply-node]')?.click();
    await flush();

    const target = rowInputs(actionRow).target;
    expect(target.getAttribute('aria-invalid')).toBe('false');
    expect(actionRow.querySelector(`[id="${target.id}-error"]`)).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);

    expect(callAt(bindingsMock.saveNodeRemoteBindings.mock.calls, 'saveNodeRemoteBindings call')[0]).toEqual({ actions: { setLevel: { node: 'Lighting' } } });
    expect(target.getAttribute('aria-invalid')).toBe('false');
    expect(actionRow.querySelector(`[id="${target.id}-error"]`)).toBeNull();
  });

  it('blocks an invalid supplied target and renders its alert below the field', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            setLevel: {
              type: 'object',
              properties: {
                node: { type: 'string', required: true },
                action: { type: 'string', enum: ['Dim'], required: true }
              }
            }
          }
        }
      }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {} } });

    await mountBindings();

    const actionRow = rowAt('actions', 0, 'first');
    const target = rowInputs(actionRow).target;
    await setInputValue(target, 'MissingAction');

    const errorId = target.getAttribute('aria-describedby');
    const error = errorId ? actionRow.querySelector<HTMLElement>(`[id="${errorId}"]`) : null;
    expect(target.getAttribute('aria-invalid')).toBe('true');
    expect(target.getAttribute('aria-describedby')).toBe(error?.id);
    expect(error?.textContent).toContain('available values');
    expect(error?.classList.contains('block')).toBe(true);
    expect(error?.classList.contains('mt-1')).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    submitForm();
    await flush();
    expect(bindingsMock.saveNodeRemoteBindings).not.toHaveBeenCalled();
  });

  it('keeps validation IDs unique and references local across instances and repeated errors', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({
      type: 'object',
      properties: { actions: { type: 'object', properties: { setLevel: {
        type: 'object', properties: { node: { type: 'string' }, action: { type: 'string', enum: ['Dim'] } }
      } } } }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } }, events: {} });
    const first = await mountBindings();
    const second = document.createElement('nodel-bindings') as NodelBindings;
    document.body.append(second);
    await waitFor(() => bindingsMock.getNodeRemoteSchema.mock.calls.length === 2 && bindingsMock.getNodeRemoteBindings.mock.calls.length === 2, { attempts: 100, intervalMs: 1 });
    await waitFor(() => second.querySelector('[data-bindings-row-id]') !== null, { attempts: 100, intervalMs: 1 });
    const firstTarget = queryRequired<HTMLInputElement>('[data-bindings-target]', first);
    const secondTarget = queryRequired<HTMLInputElement>('[data-bindings-target]', second);
    expect(firstTarget.labels?.[0]?.control).toBe(firstTarget);
    expect(secondTarget.labels?.[0]?.control).toBe(secondTarget);
    const checkLocalError = (target: HTMLInputElement) => {
      const errorId = target.getAttribute('aria-describedby');
      expect(errorId).toBeTruthy();
      const error = document.getElementById(errorId!);
      expect(error?.closest('[data-bindings-row-id]')).toBe(target.closest('[data-bindings-row-id]'));
      expect(document.querySelectorAll(`[id="${target.id}"]`)).toHaveLength(1);
      expect(document.querySelectorAll(`[id="${errorId}"]`)).toHaveLength(1);
    };

    await setInputValue(firstTarget, 'MissingAction');
    await setInputValue(secondTarget, 'MissingAction');
    expect(firstTarget.id).not.toBe(secondTarget.id);
    checkLocalError(firstTarget);
    checkLocalError(secondTarget);
    await setInputValue(firstTarget, 'Dim');
    await setInputValue(secondTarget, 'Dim');
    expect(firstTarget.getAttribute('aria-describedby')).not.toContain('target-error');
    expect(secondTarget.getAttribute('aria-describedby')).not.toContain('target-error');
    await setInputValue(firstTarget, 'MissingAction');
    await setInputValue(secondTarget, 'MissingAction');
    checkLocalError(firstTarget);
    checkLocalError(secondTarget);
  });

  it('reveals validation for invalid saved values that have not been edited', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue({
      type: 'object',
      properties: { actions: { type: 'object', properties: { setLevel: {
        type: 'object', properties: { node: { type: 'string' }, action: { type: 'string', enum: ['Dim'] } }
      } } } }
    });
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Unavailable' } }, events: {} });
    await mountBindings();
    const row = rowAt('actions', 0, 'invalid baseline');
    expect(rowInputs(row).target.getAttribute('aria-invalid')).toBe('true');
    await setInputValue(rowInputs(row).target, 'Dim');
    document.querySelector<NodelBindings>('nodel-bindings')?.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      (event as CustomEvent<{ resolve(confirmed: boolean): void }>).detail.resolve(true);
    }, { once: true });
    document.querySelector<HTMLButtonElement>('[data-bindings-revert]')?.click();
    await waitFor(() => rowInputs(rowAt('actions', 0, 'reverted invalid')).target.value === 'Unavailable');
    expect(rowInputs(rowAt('actions', 0, 'reverted invalid')).target.getAttribute('aria-invalid')).not.toBe('true');
    const disclosure = queryRequired<HTMLElement>('[data-bindings-section="actions"]');
    queryRequired<HTMLDetailsElement>('details', disclosure).open = false;
    await waitFor(() => !disclosure.hasAttribute('open'));
    await setInputValue(queryInput('[data-bindings-filter]'), 'hidden');
    document.querySelector<HTMLButtonElement>('[data-bindings-show-invalid]')?.click();
    await flush();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Filters cleared. Showing invalid bindings.');
    const invalidTarget = rowInputs(rowAt('actions', 0, 'revealed invalid')).target;
    expect(invalidTarget.getAttribute('aria-invalid')).toBe('true');
    expect(invalidTarget).toBe(document.activeElement);
    expect(disclosure.hasAttribute('open')).toBe(true);
    await setInputValue(queryInput('[data-bindings-filter]'), 'Unavailable');
    await setInputValue(queryInput('[data-bindings-filter]'), '');
    expect(disclosure.hasAttribute('open')).toBe(true);
  });

  it('selects a bulk node autocomplete option with the keyboard before applying it', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);
    bindingsMock.getNodeUrlsForNode.mockResolvedValue([
      { node: 'Lighting', address: `${window.location.origin}/nodes/Lighting/`, host: 'local' }
    ]);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const secondAction = rowAt('actions', 1, 'second');
    await selectRow(firstAction);
    const bulkNode = queryInput('[data-bindings-bulk-node]');
    await setInputValue(bulkNode, 'Light');
    await waitFor(() => document.querySelectorAll('[data-bindings-option="bulk-node"]').length === 1);

    await pressKey(bulkNode, 'ArrowDown');
    await pressKey(bulkNode, 'Enter');
    document.querySelector<HTMLButtonElement>('[data-bindings-apply-node]')?.click();
    await flush();

    expect(bulkNode.value).toBe('Lighting');
    expect(rowInputs(firstAction).node.value).toBe('Lighting');
    expect(rowInputs(secondAction).node.value).toBe('');
    await waitFor(() => firstAction.querySelector<HTMLAnchorElement>('[data-bindings-open-node]')?.href === `${window.location.origin}/nodes/Lighting/`);
  });

  it('uses one shared toolbar and closes the bulk node dropdown on blur', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: { statusChanged: {} } });
    bindingsMock.searchNodeUrls.mockResolvedValue([
      { node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }
    ]);

    await mountBindings();

    expect(document.querySelectorAll('.nodel-bindings-toolbar-panel').length).toBe(1);
    expect(document.querySelector<HTMLInputElement>('[data-bindings-bulk-node]')?.getAttribute('aria-label')).toBe('Node to set on selected bindings');
    expect(document.querySelector('.nodel-bindings-edit-toolbar label')?.textContent).toContain('Node to set on selected bindings');

    const bulkNode = queryInput('[data-bindings-bulk-node]');
    await setInputValue(bulkNode, 'Light');
    await waitFor(() => document.querySelectorAll('[data-bindings-option="bulk-node"]').length === 1);

    bulkNode.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    await flush();

    expect(document.querySelectorAll('[data-bindings-option="bulk-node"]').length).toBe(0);
  });

  it('closes an open node dropdown with Escape and ignores stale responses', async () => {
    const pendingSearch = deferred<NodelNodeUrlEntry[]>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls
      .mockResolvedValueOnce([{ node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }])
      .mockReturnValueOnce(pendingSearch.promise);

    await mountBindings();

    const firstAction = rowAt('actions', 0, 'first');
    const nodeInput = rowInputs(firstAction).node;
    await setInputValue(nodeInput, 'Light');
    await waitFor(() => firstAction.querySelectorAll('[data-bindings-option="node"]').length === 1);

    await setInputValue(nodeInput, 'Lighti');
    expect(nodeInput.getAttribute('aria-busy')).toBe('true');
    await pressKey(nodeInput, 'Escape');
    expect(nodeInput.getAttribute('aria-busy')).toBe('false');
    pendingSearch.resolve([{ node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }]);
    await flush();

    expect(firstAction.querySelector('.nodel-bindings-popover')).toBeNull();
    expect(rowInputs(firstAction).node.value).toBe('Lighti');
  });

  it('clears bulk node busy state synchronously on focusout', async () => {
    const pendingSearch = deferred<NodelNodeUrlEntry[]>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockReturnValue(pendingSearch.promise);

    await mountBindings();
    const bulkNode = queryInput('[data-bindings-bulk-node]');
    await setInputValue(bulkNode, 'Light');
    await waitFor(() => bindingsMock.searchNodeUrls.mock.calls.length === 1);
    expect(bulkNode.getAttribute('aria-busy')).toBe('true');

    bulkNode.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    expect(bulkNode.getAttribute('aria-busy')).toBe('false');
    pendingSearch.resolve([{ node: 'Lighting', address: 'http://host/nodes/Lighting/', host: 'host' }]);
    await flush();

    expect(document.querySelectorAll('[data-bindings-option="bulk-node"]')).toHaveLength(0);
  });

  it('clears target busy state synchronously on Escape before options appear', async () => {
    const pendingTarget = deferred<Record<string, NodelActionDefinition>>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.getRemoteNodeActions.mockReturnValue(pendingTarget.promise);

    await mountBindings();
    const targetInput = rowInputs(rowAt('actions', 0, 'first')).target;
    await setInputValue(targetInput, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);
    expect(targetInput.getAttribute('aria-busy')).toBe('true');

    await pressKey(targetInput, 'Escape');
    expect(targetInput.getAttribute('aria-busy')).toBe('false');
    pendingTarget.resolve({ dim: { name: 'dim', title: 'Dim Level' } });
    await flush();

    expect(targetInput.getAttribute('aria-busy')).toBe('false');
    expect(rowAt('actions', 0, 'first').querySelectorAll('[data-bindings-option="target"]').length).toBe(0);
  });

  it('invalidates stale target completions when the row node changes', async () => {
    const pendingTarget = deferred<Record<string, NodelActionDefinition>>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} },
      events: {}
    });
    bindingsMock.getRemoteNodeActions.mockReturnValue(pendingTarget.promise);

    await mountBindings();
    const firstAction = rowAt('actions', 0, 'first');
    const inputs = rowInputs(firstAction);
    await setInputValue(inputs.target, 'Dim');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);
    expect(inputs.target.getAttribute('aria-busy')).toBe('true');

    await setInputValue(inputs.node, 'Projector');
    expect(inputs.target.getAttribute('aria-busy')).toBe('false');
    pendingTarget.resolve({ dim: { name: 'dim', title: 'Stale Dim' } });
    await flush();

    expect(firstAction.querySelectorAll('[data-bindings-option="target"]')).toHaveLength(0);
    expect(inputs.target.getAttribute('aria-busy')).toBe('false');
  });

  it('clears the shared filter from the search control and clear button', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: {}, powerOn: {} }, events: { statusChanged: {} } });

    await mountBindings();

    const filter = queryInput('[data-bindings-filter]');
    await setInputValue(filter, 'power');
    await waitFor(() => rows('actions').length === 1);
    expect(document.querySelector('[data-bindings-select="visible"]')?.textContent).toContain('Select filtered');
    expect(rowAt('actions', 0, 'first').textContent).toContain('Power On');

    filter.value = '';
    filter.dispatchEvent(new Event('search'));
    await waitFor(() => rows('actions').length === 2);
    expect(document.querySelector('[data-bindings-select="visible"]')?.textContent).toContain('Select all');

    await setInputValue(filter, '   ');
    expect(document.querySelector('[data-bindings-select="visible"]')?.textContent).toContain('Select all');

    await setInputValue(filter, 'status');
    await waitFor(() => rows('events').length === 1 && rows('actions').length === 0);

    document.querySelector<HTMLButtonElement>('[data-bindings-clear-filter]')?.click();
    await waitFor(() => rows('actions').length === 2 && rows('events').length === 1);
    expect(filter.value).toBe('');
  });

  it('filters by saved binding status and clears the status criterion', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Display', action: 'Dim' }, powerOn: {} }, events: { statusChanged: {} } });
    await mountBindings();
    activityMock.listener?.({
      loading: false,
      connected: true,
      error: '',
      batch: { replace: false, transport: 'websocket', nextSeq: 2, items: [{ changed: true, live: false, entry: { seq: 1, timestamp: '2026-05-25T00:00:00Z', source: 'remote', type: 'actionBinding', alias: 'setLevel', arg: 'Wired' } }] }
    });
    await flush();
    const status = queryRequired<HTMLSelectElement>('[data-bindings-status-filter]');
    status.value = 'Wired';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(rows('actions')).toHaveLength(1);
    expect(rows('events')).toHaveLength(0);
    expect(status.getAttribute('aria-label')).toBe('Saved binding status');
    expect(document.querySelector('[data-bindings-select="visible"]')?.textContent).toContain('Select filtered');
    document.querySelector<HTMLButtonElement>('[data-bindings-clear-filter]')?.click();
    await flush();
    expect(rows('actions')).toHaveLength(2);
    expect(rows('events')).toHaveLength(1);
    expect(status.value).toBe('All');
    document.querySelector<HTMLButtonElement>('[data-bindings-select="visible"]')?.click();
    await flush();
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('[data-bindings-row-select]')).every((checkbox) => checkbox.checked)).toBe(true);
  });

  it('does not treat cached replacement history as fresh status after saving', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } }, events: {} });
    const element = await mountBindings();
    const row = rowAt('actions', 0, 'first');
    const activity = (arg: string, changed: boolean, replace: boolean, seq = 1) => activityMock.listener?.({
      loading: false,
      connected: true,
      error: '',
      batch: { replace, transport: 'poll', nextSeq: seq + 1, items: [{ changed, live: false, entry: { seq, timestamp: `2026-05-25T00:00:0${seq}Z`, source: 'remote', type: 'actionBinding', alias: 'setLevel', arg } }] }
    });
    activity('Wired', true, false);
    await flush();
    await setInputValue(rowInputs(row).target, 'Other');
    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);
    await waitFor(() => row.textContent?.includes('Unknown'));

    activity('Wired', false, true);
    await flush();
    expect(row.textContent).toContain('Unknown');

    activity('Wired', true, false, 2);
    await flush();
    expect(row.textContent).toContain('Wired');
    expect(element.textContent).toContain('Saved');
  });

  it('accepts a non-replacement polling status after activity source recovery', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } }, events: {} });
    await mountBindings();
    const row = rowAt('actions', 0, 'first');
    activityMock.listener?.({ loading: false, connected: false, error: '', batch: null });
    await flush();
    expect(row.textContent).toContain('Unknown');
    activityMock.listener?.({
      loading: false,
      connected: true,
      error: '',
      batch: { replace: false, transport: 'poll', nextSeq: 2, items: [{ changed: false, live: false, entry: { seq: 1, timestamp: '2026-05-25T00:00:00Z', source: 'remote', type: 'actionBinding', alias: 'setLevel', arg: 'Wired' } }] }
    });
    await flush();
    expect(row.textContent).toContain('Wired');
  });

  it('prevents Enter in filters and bulk node input from submitting drafts', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' } }, events: {} });
    await mountBindings();
    await setInputValue(rowInputs(rowAt('actions', 0, 'first')).target, 'Unsaved');
    const filterEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    queryInput('[data-bindings-filter]').dispatchEvent(filterEnter);
    const bulkEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    queryInput('[data-bindings-bulk-node]').dispatchEvent(bulkEnter);
    expect(filterEnter.defaultPrevented).toBe(true);
    expect(bulkEnter.defaultPrevented).toBe(true);
    expect(bindingsMock.saveNodeRemoteBindings).not.toHaveBeenCalled();
  });

  it('resolves exact node names, retains direct links through activity, and restores links on revert', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: ' Lighting ', action: 'Dim' } }, events: {} });
    bindingsMock.getNodeUrlsForNode.mockResolvedValue([{ node: ' Lighting ', address: `${window.location.origin}/nodes/Lighting/`, host: 'local' }]);
    const element = await mountBindings();
    const row = rowAt('actions', 0, 'first');
    const link = queryRequired<HTMLAnchorElement>('[data-bindings-open-node]', row);
    await waitFor(() => link.href === `${window.location.origin}/nodes/Lighting/`);
    expect(bindingsMock.getNodeUrlsForNode).toHaveBeenCalledWith(' Lighting ', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    activityMock.listener?.({
      loading: false,
      connected: true,
      error: '',
      batch: { replace: false, transport: 'websocket', nextSeq: 2, items: [{ changed: true, live: false, entry: { seq: 1, timestamp: '2026-05-25T00:00:00Z', source: 'remote', type: 'actionBinding', alias: 'setLevel', arg: 'Wired' } }] }
    });
    await flush();
    expect(link.href).toBe(`${window.location.origin}/nodes/Lighting/`);

    await setInputValue(rowInputs(row).node, 'Projector');
    expect(link.getAttribute('href')).toBe('/nodes.html?filter=Projector#Network');
    expect(link.href).not.toBe(`${window.location.origin}/nodes/Lighting/`);
    element.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      (event as CustomEvent<{ resolve(confirmed: boolean): void }>).detail.resolve(true);
    }, { once: true });
    document.querySelector<HTMLButtonElement>('[data-bindings-revert]')?.click();
    await waitFor(() => rowInputs(rowAt('actions', 0, 'reverted')).node.value === ' Lighting ');
    await waitFor(() => rowAt('actions', 0, 'reverted').querySelector<HTMLAnchorElement>('[data-bindings-open-node]')?.href === `${window.location.origin}/nodes/Lighting/`, { attempts: 150, intervalMs: 2 });
  });

  it('reconciles delayed direct links after text and status filters replace their anchors', async () => {
    const delayed = deferred<NodelNodeUrlEntry[]>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: 'Dim' }, powerOn: { node: 'Sensor', action: 'On' } }, events: {} });
    bindingsMock.getNodeUrlsForNode.mockImplementation((name) => name === 'Lighting' ? delayed.promise : Promise.resolve([]));
    await mountBindings();
    const direct = `${window.location.origin}/nodes/Lighting/`;
    await waitFor(() => bindingsMock.getNodeUrlsForNode.mock.calls.some(([name]) => name === 'Lighting'));
    const originalLink = queryRequired<HTMLAnchorElement>('[data-bindings-open-node]', rowAt('actions', 0, 'first'));
    await setInputValue(queryInput('[data-bindings-filter]'), 'power');
    expect(originalLink.isConnected).toBe(false);
    await setInputValue(queryInput('[data-bindings-filter]'), '');
    await waitFor(() => bindingsMock.getNodeUrlsForNode.mock.calls.filter(([name]) => name === 'Lighting').length === 2);
    delayed.resolve([{ node: 'Lighting', address: direct }]);
    await waitFor(() => rowAt('actions', 0, 'restored').querySelector<HTMLAnchorElement>('[data-bindings-open-node]')?.href === direct);

    const status = queryRequired<HTMLSelectElement>('[data-bindings-status-filter]');
    status.value = 'Unset';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(rows('actions')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-bindings-clear-filter]')?.click();
    await waitFor(() => rowAt('actions', 0, 'clear filters').querySelector<HTMLAnchorElement>('[data-bindings-open-node]')?.href === direct);
  });

  it('reverts a hidden selected node without retaining its draft link or target address', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'OriginalNode', action: 'Dim' }, powerOn: {} }, events: {} });
    bindingsMock.searchNodeUrls.mockImplementation(async (name) => name === 'Other' ? [{ node: 'OtherNode', address: 'http://other.test/nodes/OtherNode/', host: 'other.test' }] : []);
    const element = await mountBindings();
    const row = rowAt('actions', 0, 'original');
    await setInputValue(rowInputs(row).node, 'Other');
    await waitFor(() => row.querySelector('[data-bindings-option="node"]') !== null);
    row.querySelector<HTMLButtonElement>('[data-bindings-option="node"]')?.click();
    await flush();
    await setInputValue(queryInput('[data-bindings-filter]'), 'power');
    element.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      (event as CustomEvent<{ resolve(confirmed: boolean): void }>).detail.resolve(true);
    }, { once: true });
    document.querySelector<HTMLButtonElement>('[data-bindings-revert]')?.click();
    await waitFor(() => !element.textContent?.includes('Changed'));
    document.querySelector<HTMLButtonElement>('[data-bindings-clear-filter]')?.click();
    const restored = rowAt('actions', 0, 'restored');
    expect(rowInputs(restored).node.value).toBe('OriginalNode');
    expect(queryRequired<HTMLAnchorElement>('[data-bindings-open-node]', restored).getAttribute('href')).toBe('/nodes.html?filter=OriginalNode#Network');
    await setInputValue(rowInputs(restored).target, 'D');
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length > 0);
    expect(bindingsMock.getRemoteNodeActions).not.toHaveBeenCalledWith('http://other.test/nodes/OtherNode/', expect.anything());
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

    expect(callAt(bindingsMock.saveNodeRemoteBindings.mock.calls, 'saveNodeRemoteBindings call')[0].actions).toEqual({
      setLevel: { node: 'Lighting', action: 'setLevel' },
      powerOn: { node: 'Lighting', action: 'powerOn' }
    });
  });

  it('ignores an abort-insensitive suggestion after the row node changes', async () => {
    const pendingSuggestion = deferred<Record<string, NodelActionDefinition>>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting' } }, events: {} });
    bindingsMock.getRemoteNodeActions.mockReturnValue(pendingSuggestion.promise);

    await mountBindings();
    const row = rowAt('actions', 0, 'first');
    await selectRow(row);
    document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.click();
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);

    const nodeInput = rowInputs(row).node;
    expect(document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.disabled).toBe(true);
    await setInputValue(nodeInput, 'Projector');
    expect(document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.disabled).toBe(false);

    pendingSuggestion.resolve({ setLevel: { name: 'setLevel', title: 'Set Level' } });
    await flush();

    expect(row.querySelector('.nodel-bindings-suggestion')?.textContent?.trim()).toBe('-');
    expect(document.body.textContent).not.toContain('suggestion ready.');
  });

  it('ignores an abort-insensitive suggestion after the target text changes', async () => {
    const pendingSuggestion = deferred<Record<string, NodelActionDefinition>>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting' } }, events: {} });
    bindingsMock.getRemoteNodeActions.mockReturnValue(pendingSuggestion.promise);

    await mountBindings();
    const row = rowAt('actions', 0, 'first');
    await selectRow(row);
    document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.click();
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);

    const targetInput = rowInputs(row).target;
    await setInputValue(targetInput, 'Manual');
    expect(document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.disabled).toBe(false);

    pendingSuggestion.resolve({ setLevel: { name: 'setLevel', title: 'Set Level' } });
    await flush();

    expect(targetInput.value).toBe('Manual');
    expect(row.querySelector('.nodel-bindings-suggestion')?.textContent?.trim()).toBe('-');
    expect(document.body.textContent).not.toContain('suggestion ready.');
  });

  it('ignores an abort-insensitive suggestion after a target option selection', async () => {
    const pendingSuggestion = deferred<Record<string, NodelActionDefinition>>();
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({
      actions: { setLevel: { node: 'Lighting' } },
      events: { statusChanged: { node: 'Sensor' } }
    });
    bindingsMock.getRemoteNodeActions.mockReturnValue(pendingSuggestion.promise);
    bindingsMock.getRemoteNodeSignals.mockResolvedValue({
      status: { name: 'status', title: 'Status' }
    });

    await mountBindings();
    const actionRow = rowAt('actions', 0, 'first');
    const eventRow = rowAt('events', 0, 'first');
    await setInputValue(rowInputs(eventRow).target, 'Sta');
    await waitFor(() => eventRow.querySelectorAll('[data-bindings-option="target"]').length === 1);
    await selectRow(actionRow);
    await selectRow(eventRow);

    document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.click();
    await waitFor(() => bindingsMock.getRemoteNodeActions.mock.calls.length === 1);

    eventRow.querySelector<HTMLButtonElement>('[data-bindings-option="target"]')?.click();
    expect(document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.disabled).toBe(false);

    pendingSuggestion.resolve({ setLevel: { name: 'setLevel', title: 'Set Level' } });
    await flush();

    expect(rowInputs(eventRow).target.value).toBe('status');
    expect(actionRow.querySelector('.nodel-bindings-suggestion')?.textContent?.trim()).toBe('-');
    expect(document.body.textContent).not.toContain('suggestions ready.');
  });

  it('clears and ignores an abort-insensitive suggestion after disconnect', async () => {
    const pendingSuggestion = deferred<Record<string, NodelActionDefinition>>();
    let suggestionSignal: AbortSignal | null = null;
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting' } }, events: {} });
    bindingsMock.getRemoteNodeActions.mockImplementation((_url: string, init?: RequestInit) => {
      suggestionSignal = init?.signal ?? null;
      return pendingSuggestion.promise;
    });

    const bindings = await mountBindings();
    await selectRow(rowAt('actions', 0, 'first'));
    document.querySelector<HTMLButtonElement>('[data-bindings-suggest]')?.click();
    await waitFor(() => suggestionSignal !== null);

    bindings.remove();
    const suggestionRequestSignal = requireAbortSignal(suggestionSignal, 'Expected suggestion request signal to be set');
    expect(suggestionRequestSignal.aborted).toBe(true);
    expect(requireBindingsState(bindings).busy).toBe(false);

    pendingSuggestion.resolve({ setLevel: { name: 'setLevel', title: 'Set Level' } });
    await flush();

    expect(requireBindingsState(bindings).busy).toBe(false);
    expect(requireBindingsState(bindings).message).toBe('');
  });

  it('updates row status from remote binding activity entries', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Display Ünit', action: 'Dim' }, powerOn: {} }, events: {} });

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

    const actionRow = rowAt('actions', 0, 'first');
    expect(actionRow.textContent).toContain('Wired');
    const status = actionRow.querySelector<HTMLElement>('.nodel-bindings-status');
    const nodeLink = actionRow.querySelector<HTMLAnchorElement>('[data-bindings-open-node]');
    expect(status?.tagName).toBe('SPAN');
    expect(nodeLink?.getAttribute('href')).toBe('/nodes.html?filter=Display%20%C3%9Cnit#Network');
    expect(nodeLink?.getAttribute('aria-label')).toBe('Open node Display Ünit');
    expect(nodeLink?.classList.contains('nodel-button-compact')).toBe(true);
    expect(nodeLink?.classList.contains('nodel-button-ghost')).toBe(true);
    expect(nodeLink?.querySelector('svg[data-icon="arrow-up-right-from-square"]')).not.toBeNull();
    expect(nodeLink?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(nodeLink?.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    expect(nodeLink?.textContent?.trim()).toBe('');
    expect(nodeLink?.closest('.nodel-bindings-node-field')?.querySelector('[data-bindings-node]')).toBeTruthy();
    expect(nodeLink?.closest('.nodel-bindings-combobox')?.querySelector('.nodel-bindings-popover, [role="alert"]')).toBeNull();
  });

  it('normalizes the fixture-backed Empty backend status to Unwired', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Display', action: 'Dim' }, powerOn: {} }, events: { statusChanged: {} } });

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

    const actionRow = rowAt('actions', 0, 'first');
    expect(actionRow.textContent).toContain('Unwired');
    expect(actionRow.textContent).not.toContain('Empty');
  });

  it('clears stale busy state when reconnected during an abort-insensitive save', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: {}, events: {} });
    const pendingSave = deferred<unknown>();
    bindingsMock.saveNodeRemoteBindings.mockImplementationOnce(() => pendingSave.promise);
    const bindings = await mountBindings();
    submitForm();
    await waitFor(() => bindingsMock.saveNodeRemoteBindings.mock.calls.length === 1);

    bindings.remove();
    document.body.append(bindings);
    await waitFor(() => bindingsMock.getNodeRemoteSchema.mock.calls.length === 2);
    await waitFor(() => bindings.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled === true);
    pendingSave.resolve({});
    await flush();

    expect(bindings.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(bindings.textContent).not.toContain('Bindings saved.');
  });

  it('does not replace the reconnected binding model with an abort-insensitive initial load', async () => {
    const staleSchema = deferred<NodelJsonSchema>();
    const staleBindings = deferred<NodelRemoteBindings>();
    bindingsMock.getNodeRemoteSchema
      .mockImplementationOnce(() => staleSchema.promise)
      .mockResolvedValueOnce(bindingSchema);
    bindingsMock.getNodeRemoteBindings
      .mockImplementationOnce(() => staleBindings.promise)
      .mockResolvedValueOnce({ actions: { setLevel: { node: 'Current' } }, events: {} });
    const bindings = document.createElement('nodel-bindings');
    document.body.append(bindings);
    await waitFor(() => bindingsMock.getNodeRemoteSchema.mock.calls.length === 1);

    bindings.remove();
    document.body.append(bindings);
    await waitFor(() => !bindings.textContent?.includes('Loading bindings'));
    staleSchema.resolve({ type: 'object', properties: { actions: { type: 'object', properties: { stale: { type: 'object' } } } } });
    staleBindings.resolve({ actions: { stale: { node: 'Stale' } }, events: {} });
    await flush();

    expect(bindings.querySelectorAll('[data-bindings-row-id]')).toHaveLength(3);
    expect(bindings.querySelector<HTMLInputElement>('[data-bindings-node]')?.value).toBe('Current');
    expect(bindings.textContent).not.toContain('Stale');
  });

  it('aborts shared target discovery when disconnected', async () => {
    bindingsMock.getNodeRemoteSchema.mockResolvedValue(bindingSchema);
    bindingsMock.getNodeRemoteBindings.mockResolvedValue({ actions: { setLevel: { node: 'Lighting', action: '' }, powerOn: {} }, events: {} });
    const localRest = deferred<{ nodes: Record<string, { name: string }> }>();
    bindingsMock.getLocalRest.mockReturnValue(localRest.promise);

    const bindings = await mountBindings();
    await setInputValue(rowInputs(rowAt('actions', 0, 'first')).target, 'Dim');
    await waitFor(() => bindingsMock.getLocalRest.mock.calls.length === 1);
    const sharedRequest = callAt(bindingsMock.getLocalRest.mock.calls, 'getLocalRest call')[0];
    const sharedSignal = assertDefined(
      assertDefined(sharedRequest, 'Expected getLocalRest to be called with request options').signal,
      'Expected local REST request to include an AbortSignal'
    );

    bindings.remove();

    expect(sharedSignal.aborted).toBe(true);
    localRest.resolve({ nodes: {} });
    await flush();
  });
});
