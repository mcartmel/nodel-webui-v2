import { describe, expect, it, vi } from 'vitest';
import type { NodelJsonSchema } from '../src/api/nodel-types';
import {
  BindingsController,
  createBindingsViewModel,
  type BindingsLifecycleContext,
  type BindingsMutationAdapter
} from '../src/features/bindings-controller';
import { deferred } from './lifecycle-helpers';

const schema = {
  type: 'object',
  properties: {
    actions: { type: 'object', properties: {
      alpha: { type: 'object', title: 'Alpha' },
      beta: { type: 'object', title: 'Beta' }
    } },
    events: { type: 'object', properties: { changed: { type: 'object', title: 'Changed' } } }
  }
} as NodelJsonSchema;

function context(): BindingsLifecycleContext {
  return { signal: new AbortController().signal, isCurrent: () => true };
}

function mutationAdapter(): BindingsMutationAdapter {
  const replaceVisibleRows: BindingsMutationAdapter['replaceVisibleRows'] = (section, rows) => {
    section.visibleRows.splice(0, section.visibleRows.length, ...rows);
  };
  return {
    setState: vi.fn(),
    setRow: vi.fn(),
    setSection: vi.fn(),
    replaceVisibleRows
  };
}

function controller(values: Record<string, unknown>, lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() }) {
  const api = { getSchema: vi.fn().mockResolvedValue(schema), getValues: vi.fn().mockResolvedValue(values), save: vi.fn().mockResolvedValue({}) };
  const adapter = mutationAdapter();
  return { controller: new BindingsController({ state: createBindingsViewModel(), adapter, api, lookup }), api, adapter, lookup };
}

describe('BindingsController', () => {
  it('validates partial rows and supplied enum values without mutating schema', async () => {
    const original = structuredClone(schema);
    const instance = controller({ actions: { alpha: { node: 'Node', action: 'Run', extra: true } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    expect(row.nodePresent).toBe(true);
    expect(instance.controller.state.invalid).toBe(false);
    instance.controller.validate(true);
    expect(schema).toEqual(original);
  });

  it('reveals an invalid supplied enum target without rejecting partial rows', async () => {
    const enumSchema: NodelJsonSchema = {
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            alpha: { type: 'object', properties: { action: { type: 'string', enum: ['Dim'] } } }
          }
        }
      }
    };
    const api = { getSchema: vi.fn().mockResolvedValue(enumSchema), getValues: vi.fn().mockResolvedValue({ actions: { alpha: { action: 'Missing' } } }), save: vi.fn() };
    const adapter = mutationAdapter();
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() };
    const subject = new BindingsController({ state: createBindingsViewModel(), adapter, api, lookup });
    await subject.load(context());
    const row = subject.state.sections[0]!.rows[0]!;
    expect(subject.state.invalid).toBe(true);
    expect(row.targetError).toContain('available values');
    subject.editNode(row, 'Lighting');
    expect(row.targetError).toContain('available values');
  });

  it('filters, selects visible rows, summarizes, and serializes edited metadata without addresses', async () => {
    const instance = controller({ actions: { alpha: { node: 'N', action: 'A', keep: 1 }, beta: {} }, unknown: { keep: true } });
    await instance.controller.load(context());
    instance.controller.setFilter('alpha');
    expect(instance.controller.state.visibleCount).toBe(1);
    instance.controller.selectRows('visible');
    instance.controller.setBulkNode('New', context());
    instance.controller.applyBulkNode();
    instance.controller.state.sections[0]!.rows[0]!.nodeAddress = 'http://secret';
    const result = await instance.controller.save(context());
    expect(result?.status).toBe('saved');
    expect(instance.api.save).toHaveBeenCalledWith(expect.objectContaining({ unknown: { keep: true } }), expect.anything());
    expect(JSON.stringify(instance.api.save.mock.calls[0]![0])).not.toContain('secret');
  });

  it('keeps row lookups independent and suppresses same-key stale results', async () => {
    const first = new Promise<never>(() => undefined);
    const second = Promise.resolve([{ value: 'new', label: 'new', address: '', detail: '' }]);
    const lookup = { searchNodeOptions: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() };
    const instance = controller({ actions: { alpha: {} } }, lookup);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    row.node = 'new';
    instance.controller.searchNode(row, 'old', context());
    instance.controller.searchNode(row, 'new', context());
    await vi.waitFor(() => expect(row.nodeOptions).toHaveLength(1));
    expect(row.nodeOptions[0]!.value).toBe('new');
  });

  it('applies only high and medium suggestions and invalidates on selection changes', async () => {
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn()
      .mockResolvedValueOnce({ value: 'run', label: 'high: run', confidence: 'high' })
      .mockResolvedValueOnce({ value: '', label: 'No match', confidence: 'none' }), clear: vi.fn() };
    const instance = controller({ actions: { alpha: { node: 'N' }, beta: { node: 'N' } } }, lookup);
    await instance.controller.load(context());
    for (const row of instance.controller.state.sections[0]!.rows) row.selected = true;
    await instance.controller.suggest(context());
    instance.controller.applySuggestions();
    expect(instance.controller.state.sections[0]!.rows[0]!.target).toBe('run');
    expect(instance.controller.state.sections[0]!.rows[1]!.target).toBe('');
  });

  it('keeps untouched absent rows out of replacement payloads and preserves metadata', async () => {
    const instance = controller({ root: { keep: true }, actions: { alpha: { keep: 1 } } });
    await instance.controller.load(context());
    const [alpha, beta] = instance.controller.state.sections[0]!.rows;
    instance.controller.editNode(alpha!, 'Lighting');
    const result = await instance.controller.save(context());
    expect(result).toMatchObject({ status: 'saved' });
    expect(instance.api.save).toHaveBeenCalledWith({
      root: { keep: true },
      actions: { alpha: { keep: 1, node: 'Lighting' } }
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(beta!.nodeAddress).toBe('');
  });

  it('applies node, target, and bulk options synchronously', async () => {
    const instance = controller({ actions: { alpha: {}, beta: {} } });
    await instance.controller.load(context());
    const [alpha, beta] = instance.controller.state.sections[0]!.rows;
    alpha!.nodeOptions = [{ value: 'Lighting', label: 'Lighting', address: 'http://host/nodes/Lighting/', detail: 'host' }];
    instance.controller.applyNodeOption(alpha!, 0, { value: '', label: '', address: '', detail: '' });
    alpha!.targetOptions = [{ value: 'dim', label: 'Dim', detail: 'Lighting' }];
    instance.controller.applyTargetOption(alpha!, 0, { value: '', label: '', detail: '' });
    instance.controller.selectRow(alpha!, true);
    instance.controller.state.bulkNodeOptions = [{ value: 'Projector', label: 'Projector', address: 'http://host/nodes/Projector/', detail: '' }];
    instance.controller.applyBulkOption(0, { value: '', label: '', address: '', detail: '' });
    instance.controller.applyBulkNode();
    expect(alpha).toMatchObject({ node: 'Projector', nodeAddress: 'http://host/nodes/Projector/', target: 'dim', showNodeOptions: false, showTargetOptions: false });
    expect(beta!.node).toBe('');
  });

  it('filters exact searchable fields and maintains section and toolbar counts', async () => {
    const instance = controller({ actions: { alpha: { node: 'Lighting', action: 'Dim' }, beta: {} }, events: { changed: {} } });
    await instance.controller.load(context());
    instance.controller.setFilter('lighting');
    expect(instance.controller.state.visibleCount).toBe(1);
    instance.controller.selectRows('visible');
    expect(instance.controller.state.selectedCount).toBe(1);
    expect(instance.controller.state.sections[0]!.selectedCount).toBe(1);
    instance.controller.selectRows('unbound');
    expect(instance.controller.state.unboundCount).toBe(3);
  });

  it('closes a row lookup and ignores its abort-insensitive completion', async () => {
    const pending = deferred<Array<{ value: string; label: string; address: string; detail: string }>>();
    const lookup = { searchNodeOptions: vi.fn().mockReturnValue(pending.promise), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() };
    const instance = controller({ actions: { alpha: {} } }, lookup);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.editNode(row, 'Light');
    instance.controller.searchNode(row, 'Light', context());
    expect(row.searchingNode).toBe(true);
    instance.controller.closeLookup(row, 'node');
    expect(row.searchingNode).toBe(false);
    pending.resolve([{ value: 'Lighting', label: 'Lighting', address: '', detail: '' }]);
    await Promise.resolve();
    expect(row.showNodeOptions).toBe(false);
  });

  it('invalidates a target lookup when the row node changes', async () => {
    const pending = deferred<Array<{ value: string; label: string; detail: string }>>();
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn().mockReturnValue(pending.promise), getSuggestion: vi.fn(), clear: vi.fn() };
    const instance = controller({ actions: { alpha: { node: 'Lighting' } } }, lookup);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.searchTarget(row, 'Dim', context());
    instance.controller.editNode(row, 'Projector');
    pending.resolve([{ value: 'dim', label: 'Dim', detail: '' }]);
    await Promise.resolve();
    expect(row).toMatchObject({ node: 'Projector', showTargetOptions: false, searchingTarget: false });
  });

  it('invalidates suggestion snapshots when target state changes', async () => {
    const pending = deferred<{ value: string; label: string; confidence: 'high' }>();
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn().mockReturnValue(pending.promise), clear: vi.fn() };
    const instance = controller({ actions: { alpha: { node: 'Lighting' } } }, lookup);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.selectRow(row, true);
    const suggestion = instance.controller.suggest(context());
    instance.controller.editTarget(row, 'Manual');
    pending.resolve({ value: 'dim', label: 'high: dim', confidence: 'high' });
    await suggestion;
    expect(row).toMatchObject({ target: 'Manual', suggestionValue: '', suggestionLabel: '' });
  });

  it('maps only remote binding activity and retains the current-node link', async () => {
    const instance = controller({ actions: { alpha: { node: 'Lighting' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.activityEntries([
      { seq: 1, source: 'local', type: 'actionBinding', alias: 'alpha', arg: 'Wired' },
      { seq: 2, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' }
    ]);
    expect(row.status).toBe('Wired');
    expect(row.statusHref).toContain('Lighting');
    instance.controller.activityEntries([{ seq: 3, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Other' }]);
    expect(row.status).toBe('Unwired');
  });

  it('supersedes abort-insensitive loads and reports unsupported, empty, and failed loads', async () => {
    const first = deferred<NodelJsonSchema>();
    const api = { getSchema: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ type: 'object', properties: {} }), getValues: vi.fn().mockResolvedValue({}), save: vi.fn() };
    const adapter = mutationAdapter();
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() };
    const subject = new BindingsController({ state: createBindingsViewModel(), adapter, api, lookup });
    const oldLoad = subject.load(context());
    const freshLoad = await subject.load(context());
    first.resolve(schema);
    expect(await oldLoad).toMatchObject({ status: 'superseded' });
    expect(freshLoad).toMatchObject({ status: 'verified' });
    expect(subject.state.empty).toBe(true);

    api.getSchema.mockResolvedValueOnce({ ...schema, pattern: 'unsupported' });
    expect(await subject.load(context())).toMatchObject({ status: 'failed', detail: expect.stringContaining('Unsupported binding schema') });
    api.getSchema.mockRejectedValueOnce(new Error('offline'));
    expect(await subject.load(context())).toMatchObject({ status: 'failed', detail: 'offline' });
  });

  it('saves with the controller ticket signal and suppresses stale outcomes', async () => {
    const save = deferred<unknown>();
    const api = { getSchema: vi.fn().mockResolvedValue(schema), getValues: vi.fn().mockResolvedValue({ actions: { alpha: {} } }), save: vi.fn().mockReturnValue(save.promise) };
    const adapter = mutationAdapter();
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() };
    const subject = new BindingsController({ state: createBindingsViewModel(), adapter, api, lookup });
    await subject.load(context());
    const oldSave = subject.save(context());
    await subject.load(context());
    save.resolve({});
    expect(await oldSave).toMatchObject({ status: 'stale' });
    expect(api.save).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns a save error with the complete replacement payload', async () => {
    const instance = controller({ root: { keep: true }, actions: { alpha: { node: 'Lighting' } } });
    await instance.controller.load(context());
    instance.api.save.mockRejectedValueOnce(new Error('write failed'));
    const result = await instance.controller.save(context());
    expect(result).toMatchObject({ status: 'error', error: 'write failed', payload: { root: { keep: true } } });
    expect(instance.controller.state).toMatchObject({ saving: false, saveError: 'write failed' });
  });
});
