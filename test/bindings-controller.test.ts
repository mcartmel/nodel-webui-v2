import { describe, expect, it, vi } from 'vitest';
import type { NodelActivityLogEntry, NodelJsonSchema } from '../src/api/nodel-types';
import {
  BindingsController,
  createBindingsViewModel,
  type BindingsLifecycleContext,
  type BindingsMutationAdapter
} from '../src/features/bindings-controller';
import { deferred } from './lifecycle-helpers';
import type { NodeActivityBatch } from '../src/data/node-activity-source';

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

  it('counts invalid rows and changed rows by section independently of revealed messages', async () => {
    const countedSchema: NodelJsonSchema = {
      type: 'object',
      properties: {
        actions: {
          type: 'object',
          properties: {
            alpha: { type: 'object', properties: { node: { type: 'string', enum: ['N'] }, action: { type: 'string', enum: ['Run'] } } },
            beta: { type: 'object', properties: { node: { type: 'string', enum: ['N'] }, action: { type: 'string', enum: ['Run'] } } }
          }
        }
      }
    };
    const api = {
      getSchema: vi.fn().mockResolvedValue(countedSchema),
      getValues: vi.fn().mockResolvedValue({ actions: { alpha: { node: 'Bad', action: 'Wrong' }, beta: { node: 'N', action: 'Run' } } }),
      save: vi.fn().mockResolvedValue({})
    };
    const subject = new BindingsController({ state: createBindingsViewModel(), adapter: mutationAdapter(), api, lookup: { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn(), clear: vi.fn() } });
    await subject.load(context());
    const [alpha] = subject.state.sections[0]!.rows;
    expect(subject.state).toMatchObject({ invalid: true, invalidCount: 1 });
    expect(subject.state.sections[0]).toMatchObject({ invalidCount: 1, changedCount: 0 });

    subject.editNode(alpha!, 'N');
    expect(subject.state.invalidCount).toBe(1);
    subject.editTarget(alpha!, 'Run');
    expect(subject.state).toMatchObject({ invalid: false, invalidCount: 0, changedCount: 1 });
    expect(subject.state.sections[0]).toMatchObject({ invalidCount: 0, changedCount: 1 });

    subject.revert(subject.getRevision());
    expect(subject.state).toMatchObject({ invalid: true, invalidCount: 1, changedCount: 0 });
    expect(subject.state.sections[0]).toMatchObject({ invalidCount: 1, changedCount: 0 });
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
    expect(instance.controller.state.changedCount).toBe(0);
    instance.controller.editNode(alpha!, 'Later');
    const revision = instance.controller.getRevision();
    expect(instance.controller.revert(revision)).toBe(true);
    expect(alpha!.node).toBe('Lighting');
    expect(instance.api.getValues).toHaveBeenCalledTimes(1);
  });

  it('tracks presence-aware local changes, guards revert revisions, and replaces selection', async () => {
    const instance = controller({ actions: { alpha: {}, beta: { node: 'N', action: 'Run' } } });
    await instance.controller.load(context());
    const [alpha, beta] = instance.controller.state.sections[0]!.rows;
    instance.controller.editNode(alpha!, '');
    expect(alpha).toMatchObject({ dirty: true, nodeDirty: true });
    const promptRevision = instance.controller.getRevision();
    instance.controller.editNode(beta!, 'Changed');
    expect(instance.controller.revert(promptRevision)).toBe(false);
    instance.controller.setFilter('alpha');
    instance.controller.selectRows('visible');
    expect(alpha!.selected).toBe(true);
    instance.controller.selectRows('unset');
    expect(instance.controller.state.selectedCount).toBe(1);
    expect(alpha!.selected).toBe(true);
  });

  it('resets hidden reverted destination links and autocomplete addresses before target lookup', async () => {
    const instance = controller({ actions: { alpha: { node: 'OriginalNode', action: 'Run', vendor: 7 }, beta: {} } });
    instance.lookup.getTargetOptions.mockResolvedValue([]);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    row.nodeOptions = [{ value: 'OtherNode', label: 'OtherNode', address: 'https://other.test/nodes/OtherNode/', detail: '' }];
    instance.controller.applyNodeOption(row, 0, row.nodeOptions[0]!);
    row.statusHref = 'https://other.test/nodes/OtherNode/';
    instance.controller.setFilter('beta');
    expect(instance.controller.state.sections[0]!.visibleRows).not.toContain(row);
    expect(instance.controller.revert(instance.controller.getRevision())).toBe(true);
    expect(row).toMatchObject({ node: 'OriginalNode', nodeAddress: '', statusHref: '/nodes.html?filter=OriginalNode#Network', statusLinkLabel: 'Open OriginalNode in Network nodes', originalValue: { node: 'OriginalNode', action: 'Run', vendor: 7 } });
    instance.controller.searchTarget(row, 'Run', context());
    expect(instance.lookup.getTargetOptions).toHaveBeenCalledWith({ kind: 'actions', node: 'OriginalNode', nodeAddress: '' }, 'Run', expect.any(AbortSignal));
  });

  it('retains result membership through edits and prunes selection only on refresh', async () => {
    const instance = controller({ actions: { alpha: { node: 'Lamp', action: 'Dim' }, beta: { node: 'Other', action: 'On' } } });
    await instance.controller.load(context());
    instance.controller.setFilter('Lamp');
    const [alpha] = instance.controller.state.sections[0]!.rows;
    instance.controller.selectRows('visible');
    instance.controller.editNode(alpha!, 'Projector');
    expect(instance.controller.state.sections[0]!.visibleRows.map((row) => row.alias)).toEqual(['alpha']);
    expect(instance.controller.state.resultsChanged).toBe(true);
    expect(alpha!.selected).toBe(true);
    instance.controller.refreshResults();
    expect(instance.controller.state.sections[0]!.visibleRows).toHaveLength(0);
    expect(alpha!.selected).toBe(false);
  });

  it('advances the submitted save baseline and rejects edits while saving', async () => {
    const save = deferred<unknown>();
    const instance = controller({ actions: { alpha: { node: 'N', action: 'Old' } } });
    instance.api.save.mockReturnValue(save.promise);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.editTarget(row, 'Submitted');
    const pending = instance.controller.save(context());
    instance.controller.editTarget(row, 'Newer');
    save.resolve({});
    expect(await pending).toMatchObject({ status: 'saved' });
    expect(instance.controller.state.changedCount).toBe(0);
    const revision = instance.controller.getRevision();
    instance.controller.revert(revision);
    expect(row.target).toBe('Submitted');
  });

  it('blocks bulk-node draft mutation while a save is pending', async () => {
    const save = deferred<unknown>();
    const instance = controller({ actions: { alpha: { node: 'N', action: 'Run' } } });
    instance.api.save.mockReturnValue(save.promise);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.editTarget(row, 'Changed');
    instance.controller.selectRow(row, true);
    instance.controller.state.bulkNode = 'Other';

    const pendingSave = instance.controller.save(context());
    instance.controller.applyBulkNode();
    expect(row.node).toBe('N');

    save.resolve({});
    await pendingSave;
  });

  it('blocks suggestion application while a save is pending', async () => {
    const save = deferred<unknown>();
    const instance = controller({ actions: { alpha: { node: 'N', action: 'Run' } } });
    instance.api.save.mockReturnValue(save.promise);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.editNode(row, 'Changed node');
    instance.controller.selectRow(row, true);
    row.suggestionValue = 'Suggested';
    row.suggestionConfidence = 'high';

    const pendingSave = instance.controller.save(context());
    instance.controller.applySuggestions();
    expect(row.target).toBe('Run');

    save.resolve({});
    await pendingSave;
  });

  it('invalidates an in-flight suggestion when save begins', async () => {
    const save = deferred<unknown>();
    const suggestion = deferred<{ value: string; label: string; confidence: 'high' }>();
    const lookup = { searchNodeOptions: vi.fn(), getTargetOptions: vi.fn(), getSuggestion: vi.fn().mockReturnValue(suggestion.promise), clear: vi.fn() };
    const instance = controller({ actions: { alpha: { node: 'N', action: 'Run' } }, lookup });
    instance.api.save.mockReturnValue(save.promise);
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.editTarget(row, 'Changed');
    instance.controller.selectRow(row, true);
    const pendingSuggestion = instance.controller.suggest(context());
    const pendingSave = instance.controller.save(context());
    suggestion.resolve({ value: 'Stale suggestion', label: 'Stale', confidence: 'high' });
    await pendingSuggestion;
    instance.controller.applySuggestions();
    expect(row.target).toBe('Changed');
    expect(row.suggestionValue).toBe('');

    save.resolve({});
    await pendingSave;
  });

  it('preserves dirty drafts on restart and invalidates runtime status evidence', async () => {
    const instance = controller({ actions: { alpha: { node: 'N', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.activityEntries([{ seq: 1, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' }]);
    instance.controller.editTarget(row, 'Later');
    expect(instance.controller.preserveAfterRestart()).toMatchObject({ status: 'dirty-preserved' });
    expect(row).toMatchObject({ target: 'Later', status: 'Unknown', statusEvidence: 'source-invalidated' });
    expect(instance.api.getValues).toHaveBeenCalledTimes(1);
    const notice = instance.controller.state.restartNotice;
    expect(notice).toContain('bindings were not reloaded');
    instance.controller.setFilter('missing');
    instance.controller.applySuggestions();
    expect(instance.controller.state.message).toBe('0 suggestions applied.');
    expect(instance.controller.revert(instance.controller.getRevision())).toBe(true);
    expect(instance.controller.state.restartNotice).toBe(notice);
    await instance.controller.load(context());
    expect(instance.controller.state.restartNotice).toBe('');
  });

  it('accepts unchanged binding evidence from a recovered poll batch after transport loss', async () => {
    const instance = controller({ actions: { alpha: { node: 'N', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.activityEntries([{ seq: 5, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' }]);
    instance.controller.activityUnavailable();
    expect(row).toMatchObject({ status: 'Unknown', statusEvidence: 'source-invalidated' });

    // The activity source's recovery poll carries current entries as unchanged,
    // non-live items in a non-replacement batch.
    const recoveredPoll: NodeActivityBatch = {
      replace: false,
      transport: 'poll',
      nextSeq: 6,
      items: [{ entry: { seq: 5, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' }, changed: false, live: false }]
    };
    const freshBindings = new Set(recoveredPoll.items.filter((item) => item.changed || item.live).map((item) => `actions:${item.entry.alias}`));
    instance.controller.activityEntries(recoveredPoll.items.map((item) => item.entry), freshBindings);

    expect(row).toMatchObject({ status: 'Wired', statusEvidence: 'Wired' });
  });

  it('rejects cached pre-save history but accepts explicitly fresh evidence for a saved destination', async () => {
    const instance = controller({ actions: { alpha: { node: 'Old node', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.activityEntries([{ seq: 5, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' }]);
    instance.controller.editNode(row, 'New node');
    expect((await instance.controller.save(context()))?.status).toBe('saved');
    expect(row).toMatchObject({ node: 'New node', status: 'Unknown', statusEvidence: 'save-invalidated' });

    const cachedHistory = [{ seq: 5, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' } satisfies NodelActivityLogEntry];
    instance.controller.activityEntries(cachedHistory);
    expect(row.status).toBe('Unknown');
    instance.controller.activityEntries(cachedHistory, new Set(['actions:alpha']));
    expect(row.status).toBe('Unknown');
    instance.controller.activityEntries([{ ...cachedHistory[0]!, seq: 6 }], new Set(['actions:alpha']));
    expect(row.status).toBe('Wired');
  });

  it('accepts newer unchanged recovery evidence after a changed destination save and source loss', async () => {
    const instance = controller({ actions: { alpha: { node: 'Old node', action: 'Run' }, beta: { node: 'Other', action: 'Run' } } });
    await instance.controller.load(context());
    const [alpha, beta] = instance.controller.state.sections[0]!.rows;
    const old = { seq: 5, timestamp: '2026-09-27T00:00:00Z', source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' } satisfies NodelActivityLogEntry;
    instance.controller.activityEntries([old, { ...old, alias: 'beta' }]);
    instance.controller.editNode(alpha!, 'New node');
    expect((await instance.controller.save(context()))?.status).toBe('saved');
    expect(alpha).toMatchObject({ status: 'Unknown', statusEvidence: 'save-invalidated' });
    expect(beta).toMatchObject({ status: 'Wired', statusEvidence: 'Wired' });
    instance.controller.activityUnavailable();
    expect(alpha).toMatchObject({ status: 'Unknown', statusEvidence: 'save-invalidated' });
    expect(beta).toMatchObject({ status: 'Unknown', statusEvidence: 'source-invalidated' });

    instance.controller.activityEntries([old, { ...old, alias: 'beta' }]);
    expect(alpha!.status).toBe('Unknown');
    expect(beta!.status).toBe('Wired');
    const recoveredPoll: NodeActivityBatch = {
      replace: false, transport: 'poll', nextSeq: 7,
      items: [{ entry: { ...old, seq: 6, arg: 'Resolved' }, changed: false, live: false }]
    };
    instance.controller.activityEntries(recoveredPoll.items.map((item) => item.entry));
    expect(alpha).toMatchObject({ status: 'Unwired', statusEvidence: 'Unwired' });
  });

  it('requires a newer timestamp for unchanged recovery when activity sequence restarts', async () => {
    const instance = controller({ actions: { alpha: { node: 'Old', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    const old = { seq: 30, timestamp: '2026-09-27T00:00:00Z', source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' } satisfies NodelActivityLogEntry;
    instance.controller.activityEntries([old]);
    instance.controller.editNode(row, 'New');
    await instance.controller.save(context());
    instance.controller.activityUnavailable();
    instance.controller.activityEntries([{ ...old, seq: 1 }]);
    expect(row.status).toBe('Unknown');
    instance.controller.activityEntries([{ ...old, seq: 1, timestamp: '2026-09-27T00:01:00Z', arg: 'Empty' }]);
    expect(row).toMatchObject({ status: 'Unwired', statusEvidence: 'Unwired' });
  });

  it('requires explicit freshness when no pre-save observation establishes a watermark', async () => {
    const instance = controller({ actions: { alpha: { node: 'Old', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.editNode(row, 'New');
    await instance.controller.save(context());
    instance.controller.activityUnavailable();
    const entry = { seq: 50, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' } satisfies NodelActivityLogEntry;
    instance.controller.activityEntries([entry]);
    expect(row).toMatchObject({ status: 'Unknown', statusEvidence: 'save-invalidated' });
    instance.controller.activityEntries([entry], new Set(['actions:alpha']));
    expect(row).toMatchObject({ status: 'Wired', statusEvidence: 'Wired' });
  });

  it('keeps saved-status invalidation across a dirty restart and rejects cached history', async () => {
    const instance = controller({ actions: { alpha: { node: 'Old', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    const old = { seq: 5, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' } satisfies NodelActivityLogEntry;
    instance.controller.activityEntries([old]);
    instance.controller.editNode(row, 'New');
    await instance.controller.save(context());
    instance.controller.editTarget(row, 'Draft');
    instance.controller.preserveAfterRestart();
    instance.controller.activityEntries([old]);
    expect(row).toMatchObject({ status: 'Unknown', statusEvidence: 'save-invalidated' });
    instance.controller.activityEntries([{ ...old, seq: 1, timestamp: '2026-09-27T00:01:00Z' }]);
    expect(row.status).toBe('Wired');
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
    instance.controller.applyBulkOption(99, { value: 'Fallback', label: 'Fallback', address: '', detail: '' });
    expect(instance.controller.state.bulkNode).toBe('Fallback');
    instance.controller.applyNodeOption(alpha!, 99, { value: 'FallbackNode', label: 'FallbackNode', address: '', detail: '' });
    instance.controller.applyTargetOption(alpha!, 99, { value: 'fallback-target', label: 'Fallback', detail: '' });
    expect(alpha).toMatchObject({ node: 'FallbackNode', target: 'fallback-target' });
  });

  it('filters exact searchable fields and maintains confirmed-unwired counts', async () => {
    const instance = controller({ actions: { alpha: { node: 'Lighting', action: 'Dim' }, beta: {} }, events: { changed: {} } });
    await instance.controller.load(context());
    instance.controller.setFilter('lighting');
    expect(instance.controller.state.visibleCount).toBe(1);
    instance.controller.selectRows('visible');
    expect(instance.controller.state.selectedCount).toBe(1);
    expect(instance.controller.state.sections[0]!.selectedCount).toBe(1);
    instance.controller.selectRows('unset');
    expect(instance.controller.state.unboundCount).toBe(0);
    expect(instance.controller.state.selectedCount).toBe(0);
    instance.controller.clearFilter();
    expect(instance.controller.state.visibleCount).toBe(3);
    instance.controller.setFilter('no such binding');
    expect(instance.controller.state.visibleCount).toBe(0);
    instance.controller.setBulkNode('', context());
    expect(instance.controller.state.bulkNodeAddress).toBe('');
    instance.controller.selectRows('clear');
    expect(instance.controller.state.selectedCount).toBe(0);
    instance.controller.closeLookup(null, 'node');
    instance.controller.closeLookup(null, 'bulk-node');
  });

  it('replaces selection with visible saved-Unset rows, independent of runtime status and draft edits', async () => {
    const instance = controller({ actions: { alpha: {}, beta: { node: 'N', action: 'Run' } }, events: { changed: { node: 'N', event: 'Stop' } } });
    await instance.controller.load(context());
    const [unset, wired] = instance.controller.state.sections[0]!.rows;
    const [unwired] = instance.controller.state.sections[1]!.rows;
    instance.controller.activityEntries([{ seq: 1, source: 'remote', type: 'eventBinding', alias: 'changed', arg: 'Empty' }]);
    expect(unwired!.status).toBe('Unwired');
    unset!.selected = true;
    wired!.selected = true;
    instance.controller.editNode(unset!, 'Draft node');
    instance.controller.selectRows('unset');
    expect(unset!.selected).toBe(true);
    expect([wired!.selected, unwired!.selected]).toEqual([false, false]);
    expect(instance.controller.state.changedCount).toBe(1);
    expect(unset!.status).toBe('Unset');
    instance.controller.setStatusFilter('Wired');
    instance.controller.selectRows('unset');
    expect(instance.controller.state.selectedCount).toBe(0);
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
    const instance = controller({ actions: { alpha: { node: 'Lighting', action: 'Run' } } });
    await instance.controller.load(context());
    const row = instance.controller.state.sections[0]!.rows[0]!;
    instance.controller.activityEntries([
      { seq: 1, source: 'local', type: 'actionBinding', alias: 'alpha', arg: 'Wired' },
      { seq: 2, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Wired' }
    ]);
    expect(row.status).toBe('Wired');
    expect(row.statusHref).toContain('Lighting');
    instance.controller.activityEntries([{ seq: 3, source: 'remote', type: 'actionBinding', alias: 'alpha', arg: 'Other' }]);
    expect(row.status).toBe('Unknown');
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
