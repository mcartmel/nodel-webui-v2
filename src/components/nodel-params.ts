import {
  getNodeParams,
  getNodeParamsSchema,
  saveNodeParams
} from '../api/nodel-host-client';
import type { NodelJsonSchema } from '../api/nodel-types';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import {
  createSchemaForm,
  findSchemaField,
  handleSchemaFormClick,
  handleSchemaFormInput,
  handleSchemaFormToggle,
  hydrateSchemaForm,
  registerSchemaFormTemplates,
  revealSchemaValidationIssues,
  serializeSchemaForm,
  type SchemaField,
  type SchemaFormModel,
  validateAndUpdateSchemaForm
} from '../schema/schema-form';
import { apiErrorMessage, isAbortError } from '../utils/errors';
import { isRecord } from '../utils/records';
import { renderComponentError } from '../utils/render-component-error';

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

function hasSchemaFields(schema: NodelJsonSchema | null | undefined) {
  return Boolean(schema && (Object.keys(schema).length === 0 || (schema.properties && Object.keys(schema.properties).length > 0)));
}

export class NodelParams extends HTMLElement {
  private abortController: AbortController | null = null;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
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
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.renderInitializationError(error));
    }
  }

  disconnectedCallback() {
    if (this.linked) {
      this.setState({ loading: false, saving: false });
    }
    this.lifecycle.disconnect();
    this.abortController?.abort();
    this.abortController = null;
    if (this.saveMessageTimer !== null) {
      window.clearTimeout(this.saveMessageTimer);
      this.saveMessageTimer = null;
    }
    this.linked = false;
  }

  refreshAfterRestart(): Promise<NodeRestartRefreshResult> {
    const scope = this.lifecycle.current;
    return scope ? this.loadParams(scope) : Promise.resolve({ status: 'aborted', detail: 'Parameters component is disconnected.' });
  }

  private async initialize(scope: ConnectionScope) {
    await bootstrapJsViews();
    if (!scope.isCurrent()) {
      return;
    }
    registerSchemaFormTemplates();
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    scope.listen(this, 'submit', this.handleSubmit);
    scope.listen(this, 'input', this.handleInput);
    scope.listen(this, 'change', this.handleInput);
    scope.listen(this, 'click', this.handleClick);
    scope.listen(this, 'toggle', this.handleToggle, true);

    await this.loadParams(scope);
  }

  private async loadParams(scope: ConnectionScope): Promise<NodeRestartRefreshResult> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    this.setState({
      loading: true,
      error: '',
      saveError: '',
      saveMessage: '',
      saving: false,
      empty: false,
      schemaForm: null
    });

    try {
      const [schema, params] = await Promise.all([
        getNodeParamsSchema({ signal: controller.signal }),
        getNodeParams({ signal: controller.signal })
      ]);
      if (!scope.isCurrent() || controller !== this.abortController) {
        return { status: 'superseded', detail: 'Parameters refresh was superseded.' };
      }

      if (!hasSchemaFields(schema)) {
        this.setState({
          loading: false,
          empty: true,
          schemaForm: null
        });
        return { status: 'verified' };
      }

      const schemaForm = createSchemaForm(schema);
      hydrateSchemaForm(schemaForm, params);
      this.setState({
        loading: false,
        empty: false,
        schemaForm
      });
      return { status: 'verified' };
    } catch (error) {
      if (!scope.isCurrent() || controller !== this.abortController) {
        return { status: 'superseded', detail: 'Parameters refresh was superseded.' };
      }
      if (isAbortError(error)) {
        return { status: 'aborted', detail: 'Parameters refresh was canceled.' };
      }
      const detail = apiErrorMessage(error, 'Failed to load parameters');
      this.setState({
        loading: false,
        error: detail,
        empty: false,
        schemaForm: null
      });
      return { status: 'failed', detail };
    } finally {
      scope.signal.removeEventListener('abort', abort);
      if (this.abortController === controller) {
        this.abortController = null;
      }
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

    if (validateAndUpdateSchemaForm(this.state.schemaForm).length > 0) {
      revealSchemaValidationIssues(this.state.schemaForm, this);
      return;
    }

    void this.saveParams();
  };

  private handleInput = (event: Event) => {
    handleSchemaFormInput(event, this, (fieldId) => this.findField(fieldId));
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
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const payload = serializeSchemaForm(this.state.schemaForm!);
    if (!isRecord(payload)) {
      this.setState({ saveError: 'The parameter values could not be serialized.' });
      return;
    }
    this.setState({
      saving: true,
      saveError: '',
      saveMessage: ''
    });

    try {
      await saveNodeParams(payload, { signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.setState({ saveMessage: 'Saved' });
      this.dispatchEvent(new CustomEvent('nodel-params-saved', {
        bubbles: true,
        detail: { payload }
      }));
      if (this.saveMessageTimer !== null) {
        window.clearTimeout(this.saveMessageTimer);
      }
      this.saveMessageTimer = scope.setTimeout(() => {
        this.setState({ saveMessage: '' });
        this.saveMessageTimer = null;
      }, 2500);
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      const message = apiErrorMessage(error, 'Failed to save parameters');
      this.setState({ saveError: message });
      this.dispatchEvent(new CustomEvent('nodel-params-error', {
        bubbles: true,
        detail: { error: message, payload }
      }));
    } finally {
      if (scope.isCurrent()) {
        this.setState({ saving: false });
      }
    }
  }

  private renderInitializationError(error: unknown) {
    const message = apiErrorMessage(error, 'Failed to initialize parameters');
    if (this.linked) {
      this.setState({ loading: false, error: message });
    } else {
      this.dataset.state = 'error';
      renderComponentError(this, message);
    }
  }

  private setState(values: Partial<ParamsViewModel>) {
    getJQuery().observable(this.state).setProperty(values);
  }
}

if (!customElements.get('nodel-params')) {
  customElements.define('nodel-params', NodelParams);
}
