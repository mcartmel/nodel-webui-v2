import {
  getNodeParams,
  getNodeParamsSchema,
  saveNodeParams
} from '../api/nodel-host-client';
import type { NodelJsonSchema } from '../api/nodel-types';
import { bootstrapJsViews, getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';
import {
  createSchemaForm,
  findSchemaField,
  handleSchemaFormClick,
  handleSchemaFormToggle,
  hydrateSchemaForm,
  registerSchemaFormTemplates,
  serializeSchemaForm,
  type SchemaField,
  type SchemaFormModel
} from '../schema/schema-form';

interface ParamsViewModel {
  loading: boolean;
  error: string;
  saveError: string;
  saveMessage: string;
  saving: boolean;
  empty: boolean;
  schemaForm: SchemaFormModel | null;
}

const template = `
  <div class="nodel-params" data-link="class{:loading ? 'nodel-params is-loading' : 'nodel-params'}">
    <form class="nodel-params-panel space-y-3" data-params-form autocomplete="off">
      {^{if loading}}
        <div class="nodel-alert nodel-alert-md">Loading parameters...</div>
      {{else error}}
        <div class="nodel-alert nodel-alert-danger nodel-alert-md">{^{>error}}</div>
      {{else empty}}
        <div class="nodel-alert nodel-alert-md">No parameters.</div>
      {{else}}
        <fieldset data-link="disabled{:saving}">
          {^{if schemaForm}}
            {{include schemaForm tmpl="nodelSchemaForm"/}}
          {{/if}}
        </fieldset>
        <div class="flex min-w-0 flex-wrap items-center gap-3">
          <button type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:saving || !schemaForm}">
            {^{if saving}}Saving...{{else}}Save{{/if}}
          </button>
          {^{if saveMessage}}<span class="text-sm text-nodel-muted">{^{>saveMessage}}</span>{{/if}}
        </div>
        {^{if saveError}}
          <div class="nodel-alert nodel-alert-danger nodel-alert-sm">{^{>saveError}}</div>
        {{/if}}
      {{/if}}
    </form>
  </div>
`;

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function hasSchemaFields(schema: NodelJsonSchema | null | undefined) {
  return Boolean(schema?.properties && Object.keys(schema.properties).length > 0);
}

export class NodelParams extends HTMLElement {
  private abortController: AbortController | null = null;
  private linked = false;
  private saveMessageTimer: number | null = null;
  private state: ParamsViewModel = {
    loading: true,
    error: '',
    saveError: '',
    saveMessage: '',
    saving: false,
    empty: false,
    schemaForm: null
  };

  connectedCallback() {
    void this.initialize();
  }

  disconnectedCallback() {
    this.abortController?.abort();
    this.abortController = null;
    this.removeEventListener('submit', this.handleSubmit);
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('toggle', this.handleToggle, true);
    if (this.saveMessageTimer !== null) {
      window.clearTimeout(this.saveMessageTimer);
      this.saveMessageTimer = null;
    }
    void unlinkTemplate(this);
    this.linked = false;
  }

  refreshAfterRestart() {
    return this.loadParams();
  }

  private async initialize() {
    if (!this.linked) {
      await bootstrapJsViews();
      registerSchemaFormTemplates();
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.addEventListener('submit', this.handleSubmit);
      this.addEventListener('click', this.handleClick);
      this.addEventListener('toggle', this.handleToggle, true);
    }

    await this.loadParams();
  }

  private async loadParams() {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.setState({
      loading: true,
      error: '',
      saveError: '',
      saveMessage: '',
      empty: false,
      schemaForm: null
    });

    try {
      const [schema, params] = await Promise.all([
        getNodeParamsSchema({ signal: this.abortController.signal }),
        getNodeParams({ signal: this.abortController.signal })
      ]);

      if (!hasSchemaFields(schema)) {
        this.setState({
          loading: false,
          empty: true,
          schemaForm: null
        });
        return;
      }

      const schemaForm = createSchemaForm(schema);
      hydrateSchemaForm(schemaForm, params);
      this.setState({
        loading: false,
        empty: false,
        schemaForm
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({
        loading: false,
        error: apiErrorMessage(error, 'Failed to load parameters'),
        empty: false,
        schemaForm: null
      });
    }
  }

  private handleSubmit = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !target.hasAttribute('data-params-form')) {
      return;
    }

    event.preventDefault();
    if (!this.state.schemaForm || this.state.saving || this.state.error || this.state.empty) {
      return;
    }

    void this.saveParams();
  };

  private handleClick = (event: MouseEvent) => {
    handleSchemaFormClick(event, this, (fieldId) => this.findField(fieldId));
  };

  private handleToggle = (event: Event) => {
    handleSchemaFormToggle(event, this, (fieldId) => this.findField(fieldId));
  }

  private findField(fieldId: string): SchemaField | null {
    return this.state.schemaForm ? findSchemaField(this.state.schemaForm.fields, fieldId) : null;
  }

  private async saveParams() {
    const payload = serializeSchemaForm(this.state.schemaForm!) as Record<string, unknown>;
    this.setState({
      saving: true,
      saveError: '',
      saveMessage: ''
    });

    try {
      await saveNodeParams(payload);
      this.setState({ saveMessage: 'Saved' });
      this.dispatchEvent(new CustomEvent('nodel-params-saved', {
        bubbles: true,
        detail: { payload }
      }));
      if (this.saveMessageTimer !== null) {
        window.clearTimeout(this.saveMessageTimer);
      }
      this.saveMessageTimer = window.setTimeout(() => {
        this.setState({ saveMessage: '' });
        this.saveMessageTimer = null;
      }, 2500);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to save parameters');
      this.setState({ saveError: message });
      this.dispatchEvent(new CustomEvent('nodel-params-error', {
        bubbles: true,
        detail: { error: message, payload }
      }));
    } finally {
      this.setState({ saving: false });
    }
  }

  private setState(values: Partial<ParamsViewModel>) {
    getJQuery().observable(this.state).setProperty(values);
  }
}

if (!customElements.get('nodel-params')) {
  customElements.define('nodel-params', NodelParams);
}
