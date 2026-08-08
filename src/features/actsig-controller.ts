import type { NodelActionDefinition, NodelActivityLogEntry, NodelSignalDefinition } from '../api/nodel-types';
import { findSchemaField, type SchemaField } from '../schema/schema-model';
import { hydrateSchemaFormModel, resetSchemaFormDirty, serializeSchemaFormModel } from '../schema/schema-values';
import { updateSchemaFormValidation } from '../schema/schema-validation';
import { apiErrorMessage, isAbortError } from '../utils/errors';
import { hasOwn } from '../utils/records';
import { createActSigSections, createActSigViewModel, findActSigFormById, findActSigSectionById, findActSigSectionForForm, formsInSection, materializeActSigForm, syncActSigSignalControls, type ActSigFormModel, type ActSigSectionModel, type ActSigViewModel } from './actsig-model';

export interface ActSigApiPort {
  getActions(init?: RequestInit): Promise<Record<string, NodelActionDefinition>>;
  getSignals(init?: RequestInit): Promise<Record<string, NodelSignalDefinition>>;
  callAction(name: string, payload: unknown, init?: RequestInit): Promise<unknown>;
  emitSignal(name: string, payload: unknown, init?: RequestInit): Promise<unknown>;
}

export interface ActSigLifecycle {
  signal: AbortSignal;
  isCurrent(): boolean;
}

export interface ActSigMutationAdapter {
  setState(values: Partial<ActSigViewModel>): void;
  setForm(form: ActSigFormModel, values: Partial<ActSigFormModel>): void;
  setSection(section: ActSigSectionModel, values: Partial<ActSigSectionModel>): void;
}

export type ActSigLoadResult = { status: 'verified' | 'failed' | 'aborted' | 'superseded'; detail?: string };
export type ActSigSubmitResult =
  | { type: 'invalid' }
  | { type: 'submitted'; detail: { type: 'action' | 'event'; name: string; payload: unknown } }
  | { type: 'error'; detail: { type: 'action' | 'event'; name: string; error: string } }
  | { type: 'stale' };

export interface ActSigHydrationContext {
  canHydrate(section: ActSigSectionModel): boolean;
}
export interface ActSigPulse {
  form: ActSigFormModel;
  token: number;
  durationMs: 700;
}

export class ActSigController {
  readonly state: ActSigViewModel;
  private abortController: AbortController | null = null;
  private generation = 0;
  private readonly latestArgs = new Map<string, unknown>();
  private readonly pulseGenerations = new Map<string, number>();

  constructor(private readonly api: ActSigApiPort, private readonly mutation: ActSigMutationAdapter) {
    this.state = createActSigViewModel();
  }

  replaceSections(sections: ActSigSectionModel[]) {
    this.mutation.setState({ sections, hasSignals: sections.some((section) => section.rows.some((row) => row.event)), empty: sections.length === 0 });
    this.state.sections = sections;
  }

  async load(context: ActSigLifecycle): Promise<ActSigLoadResult> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const generation = ++this.generation;
    this.mutation.setState({ loading: true, error: '', empty: false });
    const stale = () => !context.isCurrent() || controller !== this.abortController || generation !== this.generation;
    try {
      const [actions, signals] = await Promise.all([this.api.getActions({ signal: controller.signal }), this.api.getSignals({ signal: controller.signal })]);
      if (stale()) return { status: 'superseded', detail: 'Actions and signals refresh was superseded.' };
      const sections = createActSigSections(actions, signals);
      this.replaceSections(sections);
      this.mutation.setState({ loading: false, error: '', empty: sections.length === 0 });
      return { status: 'verified' };
    } catch (error) {
      if (stale()) return { status: 'superseded', detail: 'Actions and signals refresh was superseded.' };
      if (isAbortError(error) || controller.signal.aborted) return { status: 'aborted', detail: 'Actions and signals refresh was canceled.' };
      const detail = apiErrorMessage(error, 'Failed to load actions and signals');
      this.mutation.setState({ loading: false, error: detail, sections: [], hasSignals: false, empty: false });
      this.state.sections = [];
      return { status: 'failed', detail };
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  abort() { this.generation += 1; this.abortController?.abort(); this.abortController = null; }
  findFormById(id: string) { return findActSigFormById(this.state.sections, id); }
  findSectionById(id: string) { return findActSigSectionById(this.state.sections, id); }
  findField(id: string): SchemaField | null {
    for (const form of this.state.sections.flatMap((section) => formsInSection(section))) {
      const field = form.schemaForm && findSchemaField(form.schemaForm.fields, id);
      if (field) return field;
    }
    return null;
  }
  formsNeedingMaterialization(section: ActSigSectionModel) { return formsInSection(section, true); }
  startMaterialization(section: ActSigSectionModel) { this.mutation.setSection(section, { materializing: true }); }
  materializeForm(form: ActSigFormModel) {
    const schemaForm = materializeActSigForm(form, this.state.overrideSignals);
    if (!schemaForm) return false;
    form.schemaForm = null;
    form.materialized = false;
    this.mutation.setForm(form, { schemaForm, materialized: true });
    form.schemaForm = schemaForm;
    form.materialized = true;
    return true;
  }
  finishMaterialization(section: ActSigSectionModel) { this.mutation.setSection(section, { materializing: false }); }
  syncSignalFormReadOnlyState() { return syncActSigSignalControls(this.state.sections, this.state.overrideSignals); }

  applyActivityEntries(entries: NodelActivityLogEntry[], context: ActSigHydrationContext) {
    const hydrated: ActSigFormModel[] = [];
    const pulses: ActSigPulse[] = [];
    for (const entry of entries) {
      if (entry.source !== 'local' || (entry.type !== 'action' && entry.type !== 'event')) continue;
      const name = String(entry.alias ?? '');
      const key = `${entry.type}:${name}`;
      if (hasOwn(entry, 'arg')) this.latestArgs.set(key, entry.arg);
      const form = this.state.sections.flatMap((section) => formsInSection(section)).find((candidate) => candidate.pointType === entry.type && candidate.name === name);
      if (!form) continue;
      const token = (this.pulseGenerations.get(form.id) ?? 0) + 1;
      this.pulseGenerations.set(form.id, token);
      this.mutation.setForm(form, { pulse: true });
      this.hydrateCachedForm(form, context, hydrated);
      pulses.push({ form, token, durationMs: 700 });
    }
    return { hydrated, pulses };
  }

  hydrateCachedForms(context: ActSigHydrationContext) {
    const hydrated: ActSigFormModel[] = [];
    for (const section of this.state.sections) {
      if (!context.canHydrate(section)) continue;
      for (const form of formsInSection(section)) this.hydrateCachedForm(form, context, hydrated);
    }
    return hydrated;
  }

  private hydrateCachedForm(form: ActSigFormModel, context: ActSigHydrationContext, hydrated: ActSigFormModel[]) {
    const section = findActSigSectionForForm(this.state.sections, form.id);
    const key = `${form.pointType}:${form.name}`;
    if (!form.schemaForm || !section || !context.canHydrate(section) || !this.latestArgs.has(key)) return;
    hydrateSchemaFormModel(form.schemaForm, { arg: this.latestArgs.get(key) }, { preserveDirty: form.pointType === 'action' });
    hydrated.push(form);
  }

  completePulse(form: ActSigFormModel, token: number) {
    if (this.pulseGenerations.get(form.id) !== token) return false;
    this.mutation.setForm(form, { pulse: false });
    return true;
  }
  pulseToken(form: ActSigFormModel) { return this.pulseGenerations.get(form.id) ?? 0; }
  clearFeedback() {
    this.latestArgs.clear();
    this.pulseGenerations.clear();
    for (const form of this.state.sections.flatMap((section) => formsInSection(section))) this.mutation.setForm(form, { pulse: false });
  }

  async submit(form: ActSigFormModel, context: ActSigLifecycle): Promise<ActSigSubmitResult> {
    if (!form.requestEligible || !form.schemaForm || form.busy || (form.pointType === 'event' && !this.state.overrideSignals)) return { type: 'invalid' };
    if (updateSchemaFormValidation(form.schemaForm).length) return { type: 'invalid' };
    const payload = serializeSchemaFormModel(form.schemaForm);
    this.mutation.setForm(form, { busy: true, error: '' });
    try {
      if (form.pointType === 'action') await this.api.callAction(form.name, payload, { signal: context.signal });
      else await this.api.emitSignal(form.name, payload, { signal: context.signal });
      if (!context.isCurrent()) return { type: 'stale' };
      resetSchemaFormDirty(form.schemaForm);
      return { type: 'submitted', detail: { type: form.pointType, name: form.name, payload } };
    } catch (error) {
      if (!context.isCurrent()) return { type: 'stale' };
      const message = apiErrorMessage(error, `Failed to ${form.pointType === 'action' ? 'call action' : 'emit signal'}`);
      this.mutation.setForm(form, { error: message });
      return { type: 'error', detail: { type: form.pointType, name: form.name, error: message } };
    } finally {
      if (context.isCurrent()) this.mutation.setForm(form, { busy: false });
    }
  }
}
