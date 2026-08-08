import { ActSigController, type ActSigMutationAdapter } from '../src/features/actsig-controller';
import { createActSigSections, formsInSection } from '../src/features/actsig-model';
import { hydrateSchemaFormModel } from '../src/schema/schema-values';

function lifecycle() {
  const controller = new AbortController();
  return { signal: controller.signal, isCurrent: () => !controller.signal.aborted, controller };
}

function setup() {
  const api = { getActions: vi.fn(), getSignals: vi.fn(), callAction: vi.fn(), emitSignal: vi.fn() };
  const mutation: ActSigMutationAdapter = { setState: vi.fn((values) => { Object.assign(state, values); }), setForm: vi.fn((form, values) => { Object.assign(form, values); }), setSection: vi.fn((section, values) => { Object.assign(section, values); }) };
  const controller = new ActSigController(api, mutation);
  const state = controller.state;
  return { api, mutation, controller, state };
}

function loadDefinitions(controller: ActSigController) {
  return controller.replaceSections(createActSigSections({ run: { name: 'Run', schema: { type: 'string' } } }, { ready: { name: 'Ready', schema: { type: 'string' } } }));
}

describe('actsig controller', () => {
  it('loads concurrently, reports empty/error, and preserves override state', async () => {
    const { api, controller, state } = setup();
    const context = lifecycle();
    let resolveActions!: (value: Record<string, never>) => void;
    let resolveSignals!: (value: Record<string, never>) => void;
    api.getActions.mockReturnValue(new Promise((resolve) => { resolveActions = resolve; }));
    api.getSignals.mockReturnValue(new Promise((resolve) => { resolveSignals = resolve; }));
    state.overrideSignals = true;
    const pending = controller.load(context);
    expect(api.getActions).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(api.getSignals).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    resolveActions({}); resolveSignals({});
    expect(await pending).toEqual({ status: 'verified' });
    expect(state.empty).toBe(true);
    expect(state.overrideSignals).toBe(true);
  });

  it('filters local activity, caches falsey own args, hydrates only eligible forms, and uses exact pulse tokens', () => {
    const { controller, mutation } = setup();
    loadDefinitions(controller);
    const section = controller.state.sections[0]!;
    const action = formsInSection(section).find((form) => form.pointType === 'action')!;
    section.open = true;
    const context = { canHydrate: () => false };
    const first = controller.applyActivityEntries([{ seq: 1, source: 'remote', type: 'action', alias: action.name, arg: 1 }, { seq: 2, source: 'local', type: 'action', alias: action.name, arg: 0 }], context);
    expect(first.pulses[0]?.form).toBe(action);
    expect(controller.completePulse(action, first.pulses[0]!.token - 1)).toBe(false);
    expect(controller.completePulse(action, first.pulses[0]!.token)).toBe(true);
    expect(mutation.setForm).toHaveBeenCalledWith(action, { pulse: true });
  });

  it('caches every own argument value, including false, zero, empty, and null', async () => {
    const { controller } = setup();
    loadDefinitions(controller);
    const section = controller.state.sections[0]!;
    section.open = true;
    const action = formsInSection(section).find((form) => form.pointType === 'action')!;
    controller.materializeForm(action);
    const context = { canHydrate: () => true };
    for (const value of [false, 0, '', null]) {
      controller.applyActivityEntries([{ seq: 1, source: 'local', type: 'action', alias: action.name, arg: value }], context);
      controller.hydrateCachedForms(context);
      expect(action.schemaForm?.sourceValue).toEqual({ arg: value });
    }
  });

  it('reports exact failed and current abort load states', async () => {
    const { api, controller, state } = setup();
    const context = lifecycle();
    api.getActions.mockRejectedValueOnce(new Error('definitions unavailable'));
    api.getSignals.mockResolvedValueOnce({ ready: { name: 'Ready' } });
    expect(await controller.load(context)).toEqual({ status: 'failed', detail: 'definitions unavailable' });
    expect(state.error).toBe('definitions unavailable');
    expect(state.sections).toEqual([]);
    expect(state.hasSignals).toBe(false);
    expect(state.empty).toBe(false);

    api.getActions.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    api.getSignals.mockResolvedValueOnce({});
    expect(await controller.load(lifecycle())).toEqual({ status: 'aborted', detail: 'Actions and signals refresh was canceled.' });
  });

  it('supersedes an abort-insensitive old load and uses one shared signal per load', async () => {
    const { api, controller, state } = setup();
    let resolveOldActions!: (value: Record<string, { name: string }>) => void;
    let resolveOldSignals!: (value: Record<string, { name: string }>) => void;
    const oldActions = new Promise<Record<string, { name: string }>>((resolve) => { resolveOldActions = resolve; });
    const oldSignals = new Promise<Record<string, { name: string }>>((resolve) => { resolveOldSignals = resolve; });
    api.getActions.mockReturnValueOnce(oldActions).mockResolvedValueOnce({ current: { name: 'Current' } });
    api.getSignals.mockReturnValueOnce(oldSignals).mockResolvedValueOnce({});
    const first = controller.load(lifecycle());
    const firstActionSignal = api.getActions.mock.calls[0]?.[0].signal;
    const firstSignalSignal = api.getSignals.mock.calls[0]?.[0].signal;
    expect(firstActionSignal).toBe(firstSignalSignal);
    const second = controller.load(lifecycle());
    const secondActionSignal = api.getActions.mock.calls[1]?.[0].signal;
    const secondSignalSignal = api.getSignals.mock.calls[1]?.[0].signal;
    expect(secondActionSignal).toBe(secondSignalSignal);
    expect(secondActionSignal).not.toBe(firstActionSignal);
    expect(await second).toEqual({ status: 'verified' });
    resolveOldActions({ old: { name: 'Old' } });
    resolveOldSignals({});
    expect(await first).toEqual({ status: 'superseded', detail: 'Actions and signals refresh was superseded.' });
    expect(formsInSection(state.sections[0]!).find((form) => form.name === 'Current')).toBeTruthy();
    expect(formsInSection(state.sections[0]!).find((form) => form.name === 'Old')).toBeUndefined();
  });

  it('preserves dirty action values but replaces dirty signal values, and defers closed hydration', async () => {
    const { controller } = setup();
    controller.replaceSections(createActSigSections({ run: { name: 'Run', schema: { type: 'string' } } }, { ready: { name: 'Ready', schema: { type: 'string' } } }));
    const section = controller.state.sections[0]!;
    const forms = formsInSection(section);
    const action = forms.find((form) => form.pointType === 'action')!;
    const signal = forms.find((form) => form.pointType === 'event')!;
    controller.materializeForm(action);
    controller.materializeForm(signal);
    hydrateSchemaFormModel(action.schemaForm!, { arg: 'edited' });
    hydrateSchemaFormModel(signal.schemaForm!, { arg: 'edited' });
    action.schemaForm!.fields[0]!.dirty = true;
    signal.schemaForm!.fields[0]!.dirty = true;
    section.open = false;
    const closed = { canHydrate: () => false };
    controller.applyActivityEntries([
      { seq: 1, source: 'local', type: 'action', alias: 'Run', arg: 'action update' },
      { seq: 2, source: 'local', type: 'event', alias: 'Ready', arg: 'signal update' }
    ], closed);
    expect(controller.hydrateCachedForms(closed)).toEqual([]);
    section.open = true;
    const hydrated = controller.hydrateCachedForms({ canHydrate: () => true });
    expect(hydrated).toEqual(expect.arrayContaining([action, signal]));
    expect(action.schemaForm!.fields[0]!.value).toBe('edited');
    expect(signal.schemaForm!.fields[0]!.value).toBe('signal update');
  });

  it('returns invalid, submitted, error, and stale outcomes with exact endpoint payloads', async () => {
    const { api, controller } = setup();
    loadDefinitions(controller);
    const action = formsInSection(controller.state.sections[0]!).find((form) => form.pointType === 'action')!;
    controller.materializeForm(action);
    action.schemaForm!.dirty = true;
    api.callAction.mockResolvedValue(undefined);
    const context = lifecycle();
    const result = await controller.submit(action, context);
    expect(result.type).toBe('submitted');
    expect(api.callAction).toHaveBeenCalledWith('Run', expect.anything(), expect.objectContaining({ signal: context.signal }));
    api.callAction.mockRejectedValue(new Error('nope'));
    const failed = await controller.submit(action, context);
    expect(failed).toEqual({ type: 'error', detail: { type: 'action', name: 'Run', error: 'nope' } });
    context.controller.abort();
    expect((await controller.submit(action, context)).type).toBe('stale');
  });

  it('blocks strict invalid, readonly, and busy submissions without API calls', async () => {
    const { api, controller, state } = setup();
    controller.replaceSections(createActSigSections({ strict: { name: 'Strict', schema: { type: 'integer' } } }, { ready: { name: 'Ready', schema: { type: 'string' } } }));
    const forms = formsInSection(state.sections[0]!);
    const strict = forms.find((form) => form.name === 'Strict')!;
    const signal = forms.find((form) => form.pointType === 'event')!;
    controller.materializeForm(strict);
    controller.materializeForm(signal);
    strict.schemaForm!.fields[0]!.value = 'not a number';
    expect((await controller.submit(strict, lifecycle())).type).toBe('invalid');
    expect(strict.schemaForm!.fields[0]!.errors).toEqual(['Enter a whole number.']);
    expect(api.callAction).not.toHaveBeenCalled();
    expect((await controller.submit(signal, lifecycle())).type).toBe('invalid');
    expect(api.emitSignal).not.toHaveBeenCalled();
    strict.busy = true;
    expect((await controller.submit(strict, lifecycle())).type).toBe('invalid');
    expect(api.callAction).not.toHaveBeenCalled();
  });

  it('emits enabled signals exactly and clears current busy state on action failure', async () => {
    const { api, controller, state } = setup();
    controller.replaceSections(createActSigSections({ run: { name: 'Run', schema: { type: 'string' } } }, { ready: { name: 'Ready', schema: { type: 'string' } } }));
    const forms = formsInSection(state.sections[0]!);
    const action = forms.find((form) => form.pointType === 'action')!;
    const signal = forms.find((form) => form.pointType === 'event')!;
    controller.materializeForm(action);
    controller.materializeForm(signal);
    hydrateSchemaFormModel(signal.schemaForm!, { arg: 'hello' });
    state.overrideSignals = true;
    api.emitSignal.mockResolvedValueOnce(undefined);
    const signalContext = lifecycle();
    const submitted = await controller.submit(signal, signalContext);
    expect(api.emitSignal).toHaveBeenCalledWith('Ready', { arg: 'hello' }, { signal: signalContext.signal });
    expect(submitted).toEqual({ type: 'submitted', detail: { type: 'event', name: 'Ready', payload: { arg: 'hello' } } });
    api.callAction.mockRejectedValueOnce(new Error('action failed'));
    const failed = await controller.submit(action, lifecycle());
    expect(failed).toEqual({ type: 'error', detail: { type: 'action', name: 'Run', error: 'action failed' } });
    expect(action.busy).toBe(false);
    expect(action.error).toBe('action failed');
  });

  it('returns stale for in-flight success and failure without stale reset or error updates', async () => {
    const { api, controller, state } = setup();
    controller.replaceSections(createActSigSections({ run: { name: 'Run', schema: { type: 'string' } } }, {}));
    const action = formsInSection(state.sections[0]!)[0]!;
    controller.materializeForm(action);
    hydrateSchemaFormModel(action.schemaForm!, { arg: 'value' });
    action.schemaForm!.dirty = true;
    let resolveSuccess!: () => void;
    api.callAction.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSuccess = resolve; }));
    const successContext = lifecycle();
    const success = controller.submit(action, successContext);
    successContext.controller.abort();
    resolveSuccess();
    expect(await success).toEqual({ type: 'stale' });
    expect(action.schemaForm!.dirty).toBe(true);
    expect(action.busy).toBe(true);
    action.busy = false;
    action.error = '';
    let rejectFailure!: (error: Error) => void;
    api.callAction.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectFailure = reject; }));
    const failureContext = lifecycle();
    const failure = controller.submit(action, failureContext);
    failureContext.controller.abort();
    rejectFailure(new Error('stale failure'));
    expect(await failure).toEqual({ type: 'stale' });
    expect(action.error).toBe('');
  });
});
