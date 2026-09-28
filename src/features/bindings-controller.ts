import type { NodelActivityLogEntry, NodelJsonSchema } from '../api/nodel-types';
import { cloneSchemaValue } from '../schema/schema-values';
import { normalizeSchema } from '../schema/schema-model';
import { apiErrorMessage, isAbortError } from '../utils/errors';
import { LatestOperationCoordinator } from '../utils/latest-operation-coordinator';
import type { BindingLookupService } from './bindings-lookup';
import {
  bindingStatusClass,
  bindingStatusLinkProperties,
  bindingRowChanged,
  bindingSuggestionClass,
  createBindingSections,
  hasBindingSchema,
  normalizeBindingStatus,
  savedBindingStatus,
  serializeBindingPayload,
  validateBindingRow,
  type BindingKind,
  type BindingOption,
  type BindingRow,
  type BindingSection
} from './bindings-model';
import type { TargetOption } from './bindings-matching';

export interface BindingsViewModel {
  loading: boolean;
  error: string;
  saveError: string;
  saveMessage: string;
  saving: boolean;
  empty: boolean;
  sections: BindingSection[];
  filter: string;
  statusFilter: 'All' | 'Unset' | 'Unwired' | 'Wired' | 'Unknown';
  resultsChanged: boolean;
  changedCount: number;
  changedOutsideResultsCount: number;
  suggestionCount: number;
  bulkNode: string;
  bulkNodeAddress: string;
  bulkNodeOptions: BindingOption[];
  showBulkNodeOptions: boolean;
  searchingBulkNode: boolean;
  selectedCount: number;
  visibleCount: number;
  unboundCount: number;
  busy: boolean;
  message: string;
  restartNotice: string;
  toolbarError: string;
  invalid: boolean;
  invalidCount: number;
}

export interface BindingsMutationAdapter {
  setState(values: Partial<BindingsViewModel>): void;
  setRow(row: BindingRow, values: Partial<BindingRow>): void;
  setSection(section: BindingSection, values: Partial<BindingSection>): void;
  replaceVisibleRows(section: BindingSection, rows: BindingRow[]): void;
}

export interface BindingsLifecycleContext {
  signal: AbortSignal;
  isCurrent(): boolean;
}

export interface BindingsApi {
  getSchema(options?: RequestInit): Promise<NodelJsonSchema>;
  getValues(options?: RequestInit): Promise<Record<string, unknown>>;
  save(payload: Record<string, unknown>, options?: RequestInit): Promise<unknown>;
}

export interface BindingsControllerOptions {
  state: BindingsViewModel;
  adapter: BindingsMutationAdapter;
  api: BindingsApi;
  lookup: Pick<BindingLookupService, 'searchNodeOptions' | 'getTargetOptions' | 'getSuggestion' | 'clear'>;
}

export type BindingsSaveOutcome =
  | { status: 'saved'; payload: Record<string, unknown> }
  | { status: 'error'; payload: Record<string, unknown>; error: string }
  | { status: 'stale'; payload: Record<string, unknown> };

export type BindingsLoadOutcome = {
  status: 'verified' | 'failed' | 'aborted' | 'superseded';
  detail?: string;
};

interface SuggestionSnapshot {
  row: BindingRow;
  kind: BindingKind;
  node: string;
  nodeAddress: string;
  alias: string;
  title: string;
  target: string;
  targetDirty: boolean;
  targetGeneration: number;
}

function newerActivityEntry(entry: NodelActivityLogEntry, previous: NodelActivityLogEntry) {
  const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  const previousTime = typeof previous.timestamp === 'string' ? Date.parse(previous.timestamp) : NaN;
  if (Number.isFinite(time) && Number.isFinite(previousTime)) {
    return time > previousTime || (time === previousTime && entry.seq > previous.seq);
  }
  if (Number.isFinite(time) && !Number.isFinite(previousTime)) return true;
  return entry.seq > previous.seq;
}

export function createBindingsViewModel(): BindingsViewModel {
  return {
    loading: true,
    error: '',
    saveError: '',
    saveMessage: '',
    saving: false,
    empty: false,
    sections: [],
    filter: '',
    statusFilter: 'All',
    resultsChanged: false,
    changedCount: 0,
    changedOutsideResultsCount: 0,
    suggestionCount: 0,
    bulkNode: '',
    bulkNodeAddress: '',
    bulkNodeOptions: [],
    showBulkNodeOptions: false,
    searchingBulkNode: false,
    selectedCount: 0,
    visibleCount: 0,
    unboundCount: 0,
    busy: false,
    message: '',
    restartNotice: '',
    toolbarError: '',
    invalid: false,
    invalidCount: 0
  };
}

export class BindingsController {
  readonly state: BindingsViewModel;
  private sourceBindings: Record<string, unknown> = {};
  private revision = 0;
  private retainedRows = new Map<string, Set<string>>();
  private resultRows = new Map<string, Set<string>>();
  private readonly loadOperations = new LatestOperationCoordinator<'load'>();
  private readonly saveOperations = new LatestOperationCoordinator<'save'>();
  private readonly lookupOperations = new LatestOperationCoordinator<string>();
  private readonly suggestionOperations = new LatestOperationCoordinator<'suggestions'>();
  private readonly targetGenerations = new Map<string, number>();
  private readonly observedActivity = new Map<string, NodelActivityLogEntry>();
  // Activity has no destination identity; these are observation watermarks, not save acknowledgements.
  private readonly savedActivityWatermarks = new Map<string, NodelActivityLogEntry | null>();

  constructor(private readonly options: BindingsControllerOptions) {
    this.state = options.state;
  }

  private setState(values: Partial<BindingsViewModel>) {
    this.options.adapter.setState(values);
    Object.assign(this.state, values);
  }

  private setRow(row: BindingRow, values: Partial<BindingRow>) {
    this.options.adapter.setRow(row, values);
    Object.assign(row, values);
  }

  private setSection(section: BindingSection, values: Partial<BindingSection>) {
    this.options.adapter.setSection(section, values);
    Object.assign(section, values);
  }

  private allRows() {
    return this.state.sections.flatMap((section) => section.rows);
  }

  private lookupKey(row: BindingRow | null, field: 'node' | 'target' | 'bulk-node') {
    return field === 'bulk-node' ? 'bulk:node' : `${row?.id ?? 'missing'}:${field}`;
  }

  private findRow(kind: BindingKind, alias: string) {
    return this.state.sections.find((section) => section.kind === kind)?.rows.find((row) => row.alias === alias) ?? null;
  }

  private targetGeneration(row: BindingRow) {
    return this.targetGenerations.get(row.id) ?? 0;
  }

  private invalidateTarget(row: BindingRow) {
    this.targetGenerations.set(row.id, this.targetGeneration(row) + 1);
  }

  setFilter(filter: string) {
    this.setState({ filter });
    this.applyResults();
  }

  setStatusFilter(statusFilter: BindingsViewModel['statusFilter']) {
    if (this.state.statusFilter === statusFilter) return;
    this.setState({ statusFilter });
    this.applyResults();
  }

  refreshResults() {
    this.applyResults();
  }

  getRevision() { return this.revision; }

  revert(expectedRevision: number) {
    if (expectedRevision !== this.revision || this.state.saving) return false;
    this.revision += 1;
    this.invalidateAsyncWork();
    for (const row of this.allRows()) {
      const value = row.originalValue;
      const node = typeof value.node === 'string' ? value.node : '';
      this.setRow(row, {
        node,
        nodeAddress: '',
        ...bindingStatusLinkProperties(node),
        target: typeof value[row.targetKey] === 'string' ? value[row.targetKey] as string : '',
        nodePresent: Object.prototype.hasOwnProperty.call(value, 'node'),
        targetPresent: Object.prototype.hasOwnProperty.call(value, row.targetKey),
        dirty: false, nodeDirty: false, targetDirty: false, changed: false,
        selected: false, nodeError: '', targetError: '', suggestionValue: '', suggestionLabel: '',
        suggestionConfidence: '', suggestionClass: bindingSuggestionClass(''), nodeOptions: [], targetOptions: []
      });
    }
    this.setState({ saveMessage: '', saveError: '' });
    this.applyResults();
    this.validate();
    return true;
  }

  preserveAfterRestart() {
    if (!this.state.changedCount) return null;
    this.revision += 1;
    this.invalidateAsyncWork();
    for (const row of this.allRows()) {
      const status = savedBindingStatus(typeof row.originalValue.node === 'string' ? row.originalValue.node : '', typeof row.originalValue[row.targetKey] === 'string' ? row.originalValue[row.targetKey] as string : '');
      this.setRow(row, { status, statusClass: bindingStatusClass(status), statusEvidence: this.savedActivityWatermarks.has(row.id) ? 'save-invalidated' : 'source-invalidated' });
    }
    this.setState({ restartNotice: 'Node restarted. Unsaved binding changes were preserved; bindings were not reloaded.', saveMessage: '' });
    return { status: 'dirty-preserved' as const, detail: 'Unsaved binding changes were preserved; bindings were not reloaded.' };
  }

  clearFilter() {
    this.setFilter('');
  }

  setBulkNode(value: string, context: BindingsLifecycleContext) {
    this.invalidateBulkLookup();
    this.setState({ bulkNode: value, bulkNodeAddress: '' });
    void this.searchBulkNodes(value, context);
  }

  editNode(row: BindingRow, value: string) {
    if (this.state.saving) return;
    this.revision += 1;
    this.setState({ saveMessage: '' });
    this.invalidateSuggestionWork();
    this.options.lookup.clear();
    this.invalidateRowLookup(row, 'target');
    this.invalidateTarget(row);
    const nodeDirty = value !== (typeof row.originalValue.node === 'string' ? row.originalValue.node : '') || !Object.prototype.hasOwnProperty.call(row.originalValue, 'node');
    const changed = nodeDirty || row.targetDirty;
    this.setRow(row, {
      node: value,
      nodeAddress: '',
      nodePresent: true,
      nodeDirty,
      dirty: changed,
      changed,
      suggestionValue: '', suggestionLabel: '', suggestionConfidence: '', suggestionClass: bindingSuggestionClass(''),
      ...bindingStatusLinkProperties(value)
    });
    this.validate();
  }

  editTarget(row: BindingRow, value: string) {
    if (this.state.saving) return;
    this.revision += 1;
    this.setState({ saveMessage: '' });
    this.invalidateSuggestionWork();
    this.invalidateRowLookup(row, 'target');
    this.invalidateTarget(row);
    const targetDirty = value !== (typeof row.originalValue[row.targetKey] === 'string' ? row.originalValue[row.targetKey] as string : '') || !Object.prototype.hasOwnProperty.call(row.originalValue, row.targetKey);
    const changed = row.nodeDirty || targetDirty;
    this.setRow(row, {
      target: value,
      targetPresent: true,
      targetDirty,
      dirty: changed,
      changed,
      suggestionValue: '',
      suggestionLabel: '',
      suggestionConfidence: '',
      suggestionClass: bindingSuggestionClass('')
    });
    this.validate();
  }

  selectRow(row: BindingRow, selected: boolean) {
    this.invalidateSuggestionWork();
    this.setRow(row, { selected });
    this.updateAllSummaries();
  }

  applyBulkOption(index: number, fallback: BindingOption) {
    const option = this.state.bulkNodeOptions[index] ?? fallback;
    this.invalidateBulkLookup();
    this.setState({
      bulkNode: option.value,
      bulkNodeAddress: option.address,
      bulkNodeOptions: [],
      showBulkNodeOptions: false
    });
  }

  applyNodeOption(row: BindingRow, index: number, fallback: BindingOption) {
    if (this.state.saving) return;
    const option = row.nodeOptions[index] ?? fallback;
    this.invalidateSuggestionWork();
    this.options.lookup.clear();
    this.invalidateRowLookup(row, 'node');
    this.invalidateRowLookup(row, 'target');
    this.invalidateTarget(row);
    this.revision += 1;
    const nodeDirty = option.value !== (typeof row.originalValue.node === 'string' ? row.originalValue.node : '') || !Object.prototype.hasOwnProperty.call(row.originalValue, 'node');
    this.setRow(row, {
      node: option.value,
      nodeAddress: option.address,
      nodePresent: true,
      dirty: nodeDirty || row.targetDirty,
      changed: nodeDirty || row.targetDirty,
      nodeDirty,
      ...bindingStatusLinkProperties(option.value),
      nodeOptions: [],
      showNodeOptions: false
    });
    this.validate();
  }

  applyTargetOption(row: BindingRow, index: number, fallback: TargetOption) {
    if (this.state.saving) return;
    const option = row.targetOptions[index] ?? fallback;
    this.invalidateSuggestionWork();
    this.invalidateRowLookup(row, 'target');
    this.invalidateTarget(row);
    this.revision += 1;
    const targetDirty = option.value !== (typeof row.originalValue[row.targetKey] === 'string' ? row.originalValue[row.targetKey] as string : '') || !Object.prototype.hasOwnProperty.call(row.originalValue, row.targetKey);
    this.setRow(row, {
      target: option.value,
      targetPresent: true,
      dirty: row.nodeDirty || targetDirty,
      changed: row.nodeDirty || targetDirty,
      targetDirty,
      targetOptions: [],
      showTargetOptions: false,
      suggestionValue: '',
      suggestionLabel: '',
      suggestionConfidence: '',
      suggestionClass: bindingSuggestionClass('')
    });
    this.validate();
  }

  closeLookup(row: BindingRow | null, field: 'node' | 'target' | 'bulk-node') {
    if (field === 'bulk-node') {
      this.invalidateBulkLookup();
    } else if (row) {
      this.invalidateRowLookup(row, field);
    }
  }

  searchNode(row: BindingRow, value: string, context: BindingsLifecycleContext) {
    void this.searchRowNodes(row, value, context);
  }

  searchTarget(row: BindingRow, value: string, context: BindingsLifecycleContext) {
    void this.searchTargets(row, value, context);
  }

  selectRows(mode: 'visible' | 'unset' | 'clear') {
    this.invalidateSuggestionWork();
    const eligible = new Set((mode === 'visible'
      ? this.state.sections.flatMap((section) => section.visibleRows)
      : mode === 'unset'
        ? this.state.sections.flatMap((section) => section.visibleRows).filter((row) => row.status === 'Unset')
        : []).map((row) => row.id));
    for (const row of this.allRows()) {
      this.setRow(row, { selected: mode !== 'clear' && eligible.has(row.id) });
    }
    this.updateAllSummaries();
  }

  applyBulkNode() {
    if (this.state.saving || !this.state.bulkNode) {
      return;
    }
    this.invalidateSuggestionWork();
    this.options.lookup.clear();
    this.revision += 1;
    this.setState({ saveMessage: '' });
    for (const row of this.allRows()) {
      if (!row.selected) {
        continue;
      }
      this.invalidateRowLookup(row, 'target');
      this.invalidateTarget(row);
      const nodeDirty = this.state.bulkNode !== (typeof row.originalValue.node === 'string' ? row.originalValue.node : '') || !Object.prototype.hasOwnProperty.call(row.originalValue, 'node');
      this.setRow(row, {
        node: this.state.bulkNode,
        nodeAddress: this.state.bulkNodeAddress,
        nodePresent: true,
        dirty: nodeDirty || row.targetDirty,
        changed: nodeDirty || row.targetDirty,
        nodeDirty,
        ...bindingStatusLinkProperties(this.state.bulkNode),
        suggestionValue: '',
        suggestionLabel: '',
        suggestionConfidence: '',
        suggestionClass: bindingSuggestionClass('')
      });
    }
    this.validate();
  }

  validate(revealAll = false) {
    const rows = this.allRows();
    const issuesByRow = new Map(rows.map((row) => [row.id, validateBindingRow(row)]));
    const issues = [...issuesByRow.values()].flat();
    const invalidRows = new Set(rows.filter((row) => (issuesByRow.get(row.id)?.length ?? 0) > 0).map((row) => row.id));
    for (const row of rows) {
      const rowIssues = issuesByRow.get(row.id) ?? [];
      const nodeIssue = rowIssues.find((issue) => issue.pointer.endsWith('/node'));
      const targetIssue = rowIssues.find((issue) => issue.pointer.endsWith(`/${row.targetKey}`));
      this.setRow(row, {
        nodeError: revealAll || row.nodeDirty || Boolean(row.nodeError)
          ? nodeIssue?.message ?? (!targetIssue && rowIssues.length ? rowIssues[0]?.message ?? '' : '')
          : '',
        targetError: revealAll || row.targetDirty || Boolean(row.targetError) ? targetIssue?.message ?? '' : ''
      });
    }
    for (const section of this.state.sections) {
      this.setSection(section, {
        invalidCount: section.rows.filter((row) => invalidRows.has(row.id)).length,
        changedCount: section.rows.filter((row) => row.dirty).length
      });
    }
    this.setState({ invalid: issues.length > 0, invalidCount: invalidRows.size });
    this.updateToolbarSummary();
    this.checkResultsChanged();
    return issues;
  }

  async suggest(context: BindingsLifecycleContext) {
    if (this.state.saving) return;
    const snapshots = this.allRows()
      .filter((row) => row.selected && row.node)
      .map((row): SuggestionSnapshot => ({
        row,
        kind: row.kind,
        node: row.node,
        nodeAddress: row.nodeAddress,
        alias: row.alias,
        title: row.title,
        target: row.target,
        targetDirty: row.targetDirty,
        targetGeneration: this.targetGeneration(row)
      }));
    if (!snapshots.length) {
      this.setState({ message: 'Select rows with a node before suggesting matches.', toolbarError: '' });
      return;
    }

    const ticket = this.suggestionOperations.begin('suggestions', context.signal);
    const isCurrentSnapshot = (snapshot: SuggestionSnapshot) => context.isCurrent()
      && ticket.isCurrent()
      && snapshot.row.selected
      && snapshot.row.kind === snapshot.kind
      && snapshot.row.node === snapshot.node
      && snapshot.row.nodeAddress === snapshot.nodeAddress
      && snapshot.row.alias === snapshot.alias
      && snapshot.row.title === snapshot.title
      && snapshot.row.target === snapshot.target
      && snapshot.row.targetDirty === snapshot.targetDirty
      && this.targetGeneration(snapshot.row) === snapshot.targetGeneration;

    this.setState({ busy: true, message: '', toolbarError: '' });
    try {
      let count = 0;
      for (const snapshot of snapshots) {
        if (!isCurrentSnapshot(snapshot)) {
          return;
        }
        const result = await this.options.lookup.getSuggestion(snapshot, ticket.signal);
        if (!isCurrentSnapshot(snapshot)) {
          return;
        }
        if (result.confidence === 'high' || result.confidence === 'medium') {
          count += 1;
        }
        this.setRow(snapshot.row, {
          suggestionValue: result.value,
          suggestionLabel: result.label,
          suggestionConfidence: result.confidence,
          suggestionClass: bindingSuggestionClass(result.confidence)
        });
        this.updateToolbarSummary();
      }
      if (context.isCurrent() && ticket.isCurrent()) {
        this.setState({ message: `${count} suggestion${count === 1 ? '' : 's'} ready.` });
      }
    } catch (error) {
      if (context.isCurrent() && ticket.isCurrent()) {
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to suggest matches') });
      }
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (context.isCurrent() && current) {
        this.setState({ busy: false });
      }
    }
  }

  applySuggestions() {
    if (this.state.saving) return;
    this.invalidateSuggestionWork();
    let count = 0;
    for (const row of this.allRows()) {
      if (!row.selected || !row.suggestionValue || (row.suggestionConfidence !== 'high' && row.suggestionConfidence !== 'medium')) {
        continue;
      }
      if (row.target === row.suggestionValue) continue;
      this.invalidateTarget(row);
      this.revision += 1;
      const targetDirty = row.suggestionValue !== (typeof row.originalValue[row.targetKey] === 'string' ? row.originalValue[row.targetKey] as string : '') || !Object.prototype.hasOwnProperty.call(row.originalValue, row.targetKey);
      this.setRow(row, { target: row.suggestionValue, targetPresent: true, dirty: row.nodeDirty || targetDirty, changed: row.nodeDirty || targetDirty, targetDirty });
      count += 1;
    }
    this.setState({ message: `${count} suggestion${count === 1 ? '' : 's'} applied.`, toolbarError: '' });
    this.validate();
  }

  async load(context: BindingsLifecycleContext): Promise<BindingsLoadOutcome> {
    this.revision += 1;
    const ticket = this.loadOperations.begin('load', context.signal);
    this.saveOperations.invalidate('save');
    this.lookupOperations.invalidateAll();
    this.invalidateSuggestionWork();
    this.clearAutocompleteState();
    this.options.lookup.clear();
    this.targetGenerations.clear();
    this.observedActivity.clear();
    this.savedActivityWatermarks.clear();
    this.sourceBindings = {};
    this.setState({ ...createBindingsViewModel() });

    try {
      const [schema, values] = await Promise.all([
        this.options.api.getSchema({ signal: ticket.signal }),
        this.options.api.getValues({ signal: ticket.signal })
      ]);
      if (!context.isCurrent() || !ticket.isCurrent()) {
        return { status: 'superseded', detail: 'Bindings refresh was superseded.' };
      }

      const normalized = normalizeSchema(schema);
      if (normalized.unsupportedReason) {
        const detail = `Unsupported binding schema: ${normalized.unsupportedReason}`;
        this.setState({ loading: false, error: detail, invalid: true });
        return { status: 'failed', detail };
      }
      if (!hasBindingSchema(normalized.schema)) {
        this.setState({ loading: false, empty: true });
        return { status: 'verified' };
      }

      this.sourceBindings = cloneSchemaValue(values);
      const sections = createBindingSections(normalized.schema, values);
      this.setState({ loading: false, empty: sections.every((section) => !section.rows.length), sections, invalid: false });
      this.applyResults();
      for (const section of sections) {
        this.updateSectionSummary(section);
      }
      this.updateToolbarSummary();
      this.validate(true);
      return { status: 'verified' };
    } catch (error) {
      if (!context.isCurrent() || !ticket.isCurrent()) {
        return { status: 'superseded', detail: 'Bindings refresh was superseded.' };
      }
      if (isAbortError(error)) {
        return { status: 'aborted', detail: 'Bindings refresh was canceled.' };
      }
      const detail = apiErrorMessage(error, 'Failed to load bindings');
      this.setState({
        loading: false,
        error: detail,
        empty: false,
        sections: [],
        selectedCount: 0,
        visibleCount: 0,
        unboundCount: 0
      });
      return { status: 'failed', detail };
    } finally {
      ticket.finish();
    }
  }

  async save(context: BindingsLifecycleContext): Promise<BindingsSaveOutcome | null> {
    if (this.validate(true).length) {
      return null;
    }
    const payload = serializeBindingPayload(this.sourceBindings, this.state.sections);
    const submitted = new Map(this.allRows().map((row) => [row.id, {
      node: row.node, target: row.target, nodePresent: row.nodePresent, targetPresent: row.targetPresent,
      nodeDirty: row.nodeDirty, targetDirty: row.targetDirty
    }]));
    const ticket = this.saveOperations.begin('save', context.signal);
    this.invalidateSuggestionWork();
    this.setState({ saving: true, saveError: '', saveMessage: '' });
    try {
      await this.options.api.save(payload, { signal: ticket.signal });
      if (!context.isCurrent() || !ticket.isCurrent()) {
        return { status: 'stale', payload };
      }
      this.sourceBindings = cloneSchemaValue(payload);
      for (const row of this.allRows()) {
        const snapshot = submitted.get(row.id)!;
        const destinationSaved = snapshot.nodeDirty || snapshot.targetDirty;
        if (destinationSaved) {
          this.savedActivityWatermarks.set(row.id, this.savedActivityWatermarks.get(row.id) ?? this.observedActivity.get(row.id) ?? null);
        }
        const baseline = cloneSchemaValue(row.originalValue);
        if (snapshot.nodeDirty) {
          if (snapshot.nodePresent) baseline.node = snapshot.node;
          else delete baseline.node;
        }
        if (snapshot.targetDirty) {
          if (snapshot.targetPresent) baseline[row.targetKey] = snapshot.target;
          else delete baseline[row.targetKey];
        }
        row.originalValue = baseline;
        row.rowPresent = Object.prototype.hasOwnProperty.call((payload[row.kind] as Record<string, unknown> | undefined) ?? {}, row.alias);
        const status = destinationSaved
          ? savedBindingStatus(typeof baseline.node === 'string' ? baseline.node : '', typeof baseline[row.targetKey] === 'string' ? baseline[row.targetKey] as string : '')
          : row.status;
        const changed = bindingRowChanged(row);
        this.setRow(row, {
          nodeDirty: row.nodePresent !== Object.prototype.hasOwnProperty.call(baseline, 'node') || row.node !== (typeof baseline.node === 'string' ? baseline.node : ''),
          targetDirty: row.targetPresent !== Object.prototype.hasOwnProperty.call(baseline, row.targetKey) || row.target !== (typeof baseline[row.targetKey] === 'string' ? baseline[row.targetKey] as string : ''),
          dirty: changed,
          changed,
          status,
          statusEvidence: destinationSaved ? 'save-invalidated' : row.statusEvidence,
          statusClass: bindingStatusClass(status)
        });
      }
      this.revision += 1;
      this.validate();
      this.setState({ saveMessage: 'Saved' });
      return { status: 'saved', payload };
    } catch (error) {
      if (!context.isCurrent() || !ticket.isCurrent()) {
        return { status: 'stale', payload };
      }
      const message = apiErrorMessage(error, 'Failed to save bindings');
      this.setState({ saveError: message });
      return { status: 'error', payload, error: message };
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (context.isCurrent() && current) {
        this.setState({ saving: false });
      }
    }
  }

  clearSaveMessage() {
    this.setState({ saveMessage: '' });
  }

  failInitialization(error: unknown) {
    this.setState({ loading: false, error: apiErrorMessage(error, 'Failed to initialize bindings') });
  }

  activityEntries(entries: NodelActivityLogEntry[], freshBindings = new Set<string>()) {
    for (const entry of entries) {
      if (entry.source !== 'remote' || (entry.type !== 'actionBinding' && entry.type !== 'eventBinding')) {
        continue;
      }
      const kind: BindingKind = entry.type === 'actionBinding' ? 'actions' : 'events';
      const row = this.findRow(kind, String(entry.alias ?? ''));
      if (!row) {
        continue;
      }
      const isFresh = freshBindings.has(`${kind}:${row.alias}`);
      if (this.savedActivityWatermarks.has(row.id)) {
        const watermark = this.savedActivityWatermarks.get(row.id);
        const newer = watermark ? newerActivityEntry(entry, watermark) : false;
        const sameEntry = watermark && entry.seq === watermark.seq && entry.timestamp === watermark.timestamp;
        if (!newer && (!isFresh || sameEntry)) continue;
        this.savedActivityWatermarks.delete(row.id);
      }
      const observed = this.observedActivity.get(row.id);
      if (!observed || newerActivityEntry(entry, observed)) this.observedActivity.set(row.id, { ...entry });
      const evidence = normalizeBindingStatus(entry.arg);
      const status = row.status === 'Unset' ? 'Unset' : evidence;
      this.setRow(row, { status, statusEvidence: evidence, statusClass: bindingStatusClass(status) });
      const section = this.state.sections.find((item) => item.kind === kind);
      if (section) {
        this.updateSectionSummary(section);
      }
    }
    this.updateToolbarSummary();
    this.checkResultsChanged();
  }

  activityUnavailable() {
    for (const row of this.allRows()) {
      const status = savedBindingStatus(typeof row.originalValue.node === 'string' ? row.originalValue.node : '', typeof row.originalValue[row.targetKey] === 'string' ? row.originalValue[row.targetKey] as string : '');
      const saveInvalidated = this.savedActivityWatermarks.has(row.id);
      this.setRow(row, {
        status: saveInvalidated ? row.status : status,
        statusEvidence: saveInvalidated ? 'save-invalidated' : 'source-invalidated',
        statusClass: bindingStatusClass(saveInvalidated ? row.status : status)
      });
    }
    this.updateAllSummaries();
    this.checkResultsChanged();
  }

  clear() {
    this.revision += 1;
    this.loadOperations.invalidateAll();
    this.saveOperations.invalidateAll();
    this.lookupOperations.invalidateAll();
    this.invalidateSuggestionWork();
    this.clearAutocompleteState();
    this.options.lookup.clear();
    this.observedActivity.clear();
    this.savedActivityWatermarks.clear();
    this.setState({ loading: false, saving: false, busy: false });
  }

  dispose() {
    this.clear();
  }

  private async searchBulkNodes(query: string, context: BindingsLifecycleContext) {
    const ticket = this.lookupOperations.begin('bulk:node', context.signal);
    this.setState({ searchingBulkNode: true, toolbarError: '' });
    try {
      const options = await this.options.lookup.searchNodeOptions(query, ticket.signal);
      if (context.isCurrent() && ticket.isCurrent() && this.state.bulkNode === query) {
        this.setState({ bulkNodeOptions: options, showBulkNodeOptions: options.length > 0 });
      }
    } catch (error) {
      if (context.isCurrent() && ticket.isCurrent()) {
        this.setState({
          bulkNodeOptions: [],
          showBulkNodeOptions: false,
          toolbarError: apiErrorMessage(error, 'Failed to search nodes')
        });
      }
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (context.isCurrent() && current) {
        this.setState({ searchingBulkNode: false });
      }
    }
  }

  private async searchRowNodes(row: BindingRow, query: string, context: BindingsLifecycleContext) {
    const ticket = this.lookupOperations.begin(this.lookupKey(row, 'node'), context.signal);
    this.setRow(row, { searchingNode: true });
    this.setState({ toolbarError: '' });
    try {
      const options = await this.options.lookup.searchNodeOptions(query, ticket.signal);
      if (context.isCurrent() && ticket.isCurrent() && row.node === query) {
        this.setRow(row, { nodeOptions: options, showNodeOptions: options.length > 0 });
      }
    } catch (error) {
      if (context.isCurrent() && ticket.isCurrent()) {
        this.setRow(row, { nodeOptions: [], showNodeOptions: false });
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to search nodes') });
      }
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (context.isCurrent() && current) {
        this.setRow(row, { searchingNode: false });
      }
    }
  }

  private async searchTargets(row: BindingRow, query: string, context: BindingsLifecycleContext) {
    const ticket = this.lookupOperations.begin(this.lookupKey(row, 'target'), context.signal);
    const node = row.node;
    const nodeAddress = row.nodeAddress;
    this.setRow(row, { searchingTarget: true });
    this.setState({ toolbarError: '' });
    try {
      const options = node
        ? await this.options.lookup.getTargetOptions({ kind: row.kind, node, nodeAddress }, query, ticket.signal)
        : [];
      if (context.isCurrent() && ticket.isCurrent() && row.target === query && row.node === node && row.nodeAddress === nodeAddress) {
        this.setRow(row, { targetOptions: options, showTargetOptions: options.length > 0 });
      }
    } catch (error) {
      if (context.isCurrent() && ticket.isCurrent()) {
        this.setRow(row, { targetOptions: [], showTargetOptions: false });
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to load target definitions') });
      }
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (context.isCurrent() && current) {
        this.setRow(row, { searchingTarget: false });
      }
    }
  }

  private invalidateBulkLookup() {
    this.lookupOperations.invalidate('bulk:node');
    this.setState({ bulkNodeOptions: [], showBulkNodeOptions: false, searchingBulkNode: false });
  }

  private invalidateRowLookup(row: BindingRow, field: 'node' | 'target') {
    this.lookupOperations.invalidate(this.lookupKey(row, field));
    this.setRow(row, field === 'node'
      ? { nodeOptions: [], showNodeOptions: false, searchingNode: false }
      : { targetOptions: [], showTargetOptions: false, searchingTarget: false });
  }

  private invalidateSuggestionWork() {
    this.suggestionOperations.invalidate('suggestions');
    if (this.state.busy) {
      this.setState({ busy: false });
    }
  }

  private invalidateAsyncWork() {
    this.lookupOperations.invalidateAll();
    this.invalidateSuggestionWork();
    this.clearAutocompleteState();
    this.options.lookup.clear();
  }

  private clearAutocompleteState() {
    this.setState({ bulkNodeOptions: [], showBulkNodeOptions: false, searchingBulkNode: false });
    for (const row of this.allRows()) {
      this.setRow(row, {
        nodeOptions: [],
        showNodeOptions: false,
        searchingNode: false,
        targetOptions: [],
        showTargetOptions: false,
        searchingTarget: false
      });
    }
  }

  private updateSectionSummary(section: BindingSection) {
    const rows = section.rows;
    this.setSection(section, {
      selectedCount: rows.filter((row) => row.selected).length,
      visibleCount: section.visibleRows.length,
      unboundCount: rows.filter((row) => row.status === 'Unwired').length,
      changedCount: rows.filter((row) => row.dirty).length,
      invalidCount: section.invalidCount
    });
  }

  private updateToolbarSummary() {
    const rows = this.allRows();
    const changedRows = rows.filter((row) => row.dirty);
    const retained = new Set([...this.retainedRows.values()].flatMap((ids) => [...ids]));
    this.setState({
      selectedCount: rows.filter((row) => row.selected).length,
      visibleCount: this.state.sections.reduce((count, section) => count + section.visibleRows.length, 0),
      unboundCount: rows.filter((row) => row.status === 'Unwired').length,
      changedCount: changedRows.length,
      changedOutsideResultsCount: changedRows.filter((row) => !retained.has(row.id)).length,
      suggestionCount: rows.filter((row) => row.selected && (row.suggestionConfidence === 'high' || row.suggestionConfidence === 'medium') && row.suggestionValue !== row.target).length
    });
  }

  private applyResults() {
    this.invalidateSuggestionWork();
    const query = this.state.filter.trim().toLocaleLowerCase();
    for (const section of this.state.sections) {
      const matches = section.rows.filter((row) => (!query || [row.alias, row.title, row.description, row.node, row.target].some((value) => value.toLocaleLowerCase().includes(query)))
        && (this.state.statusFilter === 'All' || row.status === this.state.statusFilter));
      const ids = new Set(matches.map((row) => row.id));
      this.resultRows.set(section.kind, ids);
      for (const row of section.rows) if (!ids.has(row.id) && row.selected) this.setRow(row, { selected: false });
      this.options.adapter.replaceVisibleRows(section, matches);
      this.updateSectionSummary(section);
    }
    this.retainedRows = new Map([...this.resultRows].map(([kind, ids]) => [kind, new Set(ids)]));
    this.setState({ resultsChanged: false });
    this.updateAllSummaries();
  }

  private checkResultsChanged() {
    const query = this.state.filter.trim().toLocaleLowerCase();
    const changed = this.state.sections.some((section) => {
      const candidate = section.rows.filter((row) => (!query || [row.alias, row.title, row.description, row.node, row.target].some((value) => value.toLocaleLowerCase().includes(query)))
        && (this.state.statusFilter === 'All' || row.status === this.state.statusFilter));
      const retained = this.retainedRows.get(section.kind) ?? new Set<string>();
      return candidate.length !== retained.size || candidate.some((row) => !retained.has(row.id));
    });
    this.setState({ resultsChanged: changed });
  }

  private updateAllSummaries() {
    for (const section of this.state.sections) {
      this.updateSectionSummary(section);
    }
    this.updateToolbarSummary();
  }
}
