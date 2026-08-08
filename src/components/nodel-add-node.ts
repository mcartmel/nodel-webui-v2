import type { NodelDuplicateFileFailure, NodelRecipeEntry } from '../api/nodel-types';
import {
  addNodeRecipeFromSnapshot,
  refreshAddNodeRecipes,
  isCurrentAddNodeRecipe,
  searchAddNodeTemplates,
  templateResultViews,
  type AddNodeSelection,
  type TemplateResult,
  type TemplateResultView
} from '../features/add-node';
import { createAddNodeFromTemplate, duplicateAddNodeFromSource, NodelDuplicateNodeError } from '../features/add-node-use-cases';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { activateActivePopoverOption, clearActivePopoverOption, getPopoverOptions, moveActivePopoverOption } from '../utils/popover-keyboard';
import { safeNavigationHref } from '../utils/urls';
import { boundedErrorMessage, isAbortError } from '../utils/errors';
import { LatestOperationCoordinator } from '../utils/latest-operation-coordinator';
import { nodeRecipePathCompatibility } from '../utils/node-file-path';
import { isUsableNodeName, nodeNameValidationError, trimNodeName } from '../utils/node-name';

interface AddNodeViewModel {
  createdUrl: string;
  duplicateEnabled: boolean;
  duplicateMode: boolean;
  error: string;
  failedFiles: NodelDuplicateFileFailure[];
  hasNodeResults: boolean;
  hasRecipeResults: boolean;
  includeNodeConfig: boolean;
  nodeName: string;
  open: boolean;
  recipeResults: TemplateResultView[];
  nodeResults: TemplateResultView[];
  selectionText: string;
  showAutocomplete: boolean;
  showSelection: boolean;
  status: string;
  submitting: boolean;
  templateQuery: string;
  warning: string;
}

const debounceMs = 200;
type AddNodeOperationKind = 'open' | 'search' | 'submit';

const template = `
  <div class="nodel-add-node space-y-3">
    <button type="button" class="nodel-add-node-toggle nodel-button" data-link="aria-expanded{:open ? 'true' : 'false'}">
      Add node here
    </button>

    <div class="nodel-add-node-panel nodel-panel p-4" data-link="class{:open ? 'nodel-add-node-panel nodel-panel p-4' : 'nodel-add-node-panel nodel-panel hidden p-4'}">
      <form class="space-y-4" novalidate>
        <div class="space-y-2">
          <label class="text-sm font-medium text-nodel-fg" for="nodel-add-node-name">Node name</label>
          <input id="nodel-add-node-name" class="nodel-add-node-name nodel-field w-full" type="text" autocomplete="off" data-link="nodeName trigger=true" />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-nodel-fg" for="nodel-add-node-template">Template <small class="text-nodel-muted">(optional)</small></label>
          <div class="nodel-add-node-combobox relative">
            <input id="nodel-add-node-template" class="nodel-add-node-template nodel-field w-full" type="text" placeholder="Search recipes or nodes..." autocomplete="off" data-link="templateQuery trigger=true" />
            <div class="nodel-template-selected nodel-card mt-2 px-3 py-2 text-sm text-nodel-muted" data-link="class{:showSelection ? 'nodel-template-selected nodel-card mt-2 px-3 py-2 text-sm text-nodel-muted' : 'nodel-template-selected nodel-card mt-2 hidden px-3 py-2 text-sm text-nodel-muted'}">{^{>selectionText}}</div>
            <div class="nodel-template-autocomplete nodel-popover" data-link="class{:showAutocomplete ? 'nodel-template-autocomplete nodel-popover' : 'nodel-template-autocomplete nodel-popover hidden'}">
              <ul class="divide-y divide-nodel-border">
                {^{if hasRecipeResults}}
                  <li class="nodel-section-heading px-3 py-2">Recipes</li>
                  {^{for recipeResults}}
                    <li>
                      <button type="button" class="nodel-menu-item" data-template-result-index="{{:index}}">
                        {^{>primary}}<br><span class="nodel-add-node-result-secondary">{^{>secondary}}</span>
                      </button>
                    </li>
                  {{/for}}
                {{/if}}
                {^{if hasNodeResults}}
                  <li class="nodel-section-heading px-3 py-2">Existing Nodes</li>
                  {^{for nodeResults}}
                    <li>
                      <button type="button" class="nodel-menu-item" data-template-result-index="{{:index}}">
                        {^{>primary}}<br><span class="nodel-add-node-result-secondary">{^{>secondary}}</span>
                      </button>
                    </li>
                  {{/for}}
                {{/if}}
              </ul>
            </div>
          </div>
          {^{if duplicateMode}}
            <fieldset class="nodel-add-node-duplicate-options nodel-card space-y-1 px-3 py-2" data-link="disabled{:submitting}">
              <label class="inline-flex items-center gap-2 text-sm font-medium text-nodel-fg">
                <input class="nodel-choice" type="checkbox" data-add-node-copy-config data-link="includeNodeConfig" />
                Copy configuration
              </label>
              <p class="text-xs text-nodel-muted">Includes nodeConfig.json, which may contain environment-specific settings.</p>
            </fieldset>
          {{/if}}
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            {^{if error}}
              <div class="nodel-add-node-error nodel-alert nodel-alert-danger nodel-alert-sm" role="alert">{^{>error}}</div>
              {^{if createdUrl}}
                <a class="nodel-add-node-created-link nodel-link mt-1 inline-block text-sm" data-link="href{:createdUrl}">Open created node</a>
              {{/if}}
              {^{if failedFiles.length}}
                <ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm text-nodel-muted">
                  {^{for failedFiles}}
                    <li><strong>{^{>path}}</strong>: {^{>phase}} failed{^{if status}} (HTTP {^{>status}}){{/if}} - {^{>message}}</li>
                  {{/for}}
                </ul>
              {{/if}}
            {{else warning}}
              <div class="nodel-add-node-warning nodel-alert nodel-alert-warning nodel-alert-sm space-y-1" role="alert">
                <p>{^{>warning}}</p>
                <ul class="list-disc space-y-0.5 pl-5">
                  {^{for failedFiles}}
                    <li><strong>{^{>path}}</strong>: {^{>phase}} failed{^{if status}} (HTTP {^{>status}}){{/if}} - {^{>message}}</li>
                  {{/for}}
                </ul>
                <a class="nodel-add-node-created-link nodel-link inline-block" data-link="href{:~root.createdUrl}">Open created node</a>
              </div>
            {{else}}
              <p class="nodel-add-node-status text-sm text-nodel-muted" role="status">{^{>status}}</p>
              {^{if createdUrl}}
                <a class="nodel-add-node-created-link nodel-link mt-1 inline-block text-sm" data-link="href{:createdUrl}">Open created node</a>
              {{/if}}
            {{/if}}
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="nodel-add-node-cancel nodel-button">{^{if submitting}}Cancel operation{{else}}Cancel{{/if}}</button>
            <button type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:submitting}">Add</button>
          </div>
        </div>
      </form>
    </div>
  </div>
`;

export class NodelAddNode extends HTMLElement {
  static observedAttributes = ['redirect', 'recipes', 'duplicate'];

  private debounceTimer: number | null = null;
  private linked = false;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private operations = new LatestOperationCoordinator<AddNodeOperationKind>();
  private submitGeneration: number | null = null;
  private canceledSubmitGeneration: number | null = null;
  private selectedRecipe: NodelRecipeEntry | null = null;
  private selection: AddNodeSelection = null;
  private templateResults: TemplateResult[] = [];
  private state: AddNodeViewModel = {
    createdUrl: '',
    duplicateEnabled: true,
    duplicateMode: false,
    error: '',
    failedFiles: [],
    hasNodeResults: false,
    hasRecipeResults: false,
    includeNodeConfig: false,
    nodeName: '',
    open: false,
    recipeResults: [],
    nodeResults: [],
    selectionText: '',
    showAutocomplete: false,
    showSelection: false,
    status: '',
    submitting: false,
    templateQuery: '',
    warning: ''
  };

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => {
        const message = boundedErrorMessage(error, 'Template lookup failed');
        if (this.linked) {
          this.setState({ error: message });
        } else {
          this.dataset.state = 'error';
          renderComponentError(this, message);
        }
      });
    }
  }

  disconnectedCallback() {
    this.clearDebounceTimer();
    this.operations.invalidateAll();
    this.submitGeneration = null;
    this.canceledSubmitGeneration = null;
    this.selectedRecipe = null;
    if (this.linked) {
      this.setState({ open: false, showAutocomplete: false, status: '', submitting: false });
    }
    this.lifecycle.disconnect();
    this.linked = false;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.syncAttributeState();
    }
  }

  private get allowRedirect() {
    return this.getAttribute('redirect') !== 'false';
  }

  private get allowRecipes() {
    return this.getAttribute('recipes') !== 'false';
  }

  private get allowDuplicate() {
    return this.getAttribute('duplicate') !== 'false';
  }

  private async initialize(scope: ConnectionScope) {
    this.syncAttributeState();
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    scope.listen(this, 'click', this.handleClick);
    scope.listen(this, 'submit', this.handleSubmit);
    scope.listen(document, 'click', this.handleDocumentClick);
    this.bindKeydownEvents(scope);
    this.observeControls();
    scope.own(() => this.unobserveControls());
  }

  private bindKeydownEvents(scope: ConnectionScope) {
    const name = this.querySelector<HTMLInputElement>('.nodel-add-node-name');
    const templateInput = this.querySelector<HTMLInputElement>('.nodel-add-node-template');
    if (name) {
      scope.listen(name, 'keydown', this.handleKeydown);
    }
    if (templateInput) {
      scope.listen(templateInput, 'keydown', this.handleKeydown);
    }
  }

  private observeControls() {
    const $ = getJQuery() as ReturnType<typeof getJQuery> & {
      observe: (object: unknown, paths: string, handler: () => void) => void;
    };
    $.observe(this.state, 'templateQuery', this.handleTemplateQueryChange);
  }

  private unobserveControls() {
    const $ = getJQuery() as ReturnType<typeof getJQuery> & {
      unobserve?: (object: unknown, paths: string, handler: () => void) => void;
    };
    $.unobserve?.(this.state, 'templateQuery', this.handleTemplateQueryChange);
  }

  private syncAttributeState() {
    const duplicateEnabled = this.allowDuplicate;
    this.setState({
      duplicateEnabled,
      duplicateMode: duplicateEnabled && this.selection?.type === 'node',
      includeNodeConfig: duplicateEnabled && this.selection?.type === 'node' ? this.state.includeNodeConfig : false
    });
  }

  private clearDebounceTimer() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private invalidateSearch() {
    this.clearDebounceTimer();
    this.operations.invalidate('search');
    this.operations.invalidate('open');
  }

  private cancelOperation() {
    this.canceledSubmitGeneration = this.submitGeneration;
    this.operations.invalidate('submit');
    this.setState({
      createdUrl: '',
      error: 'Operation canceled.',
      status: '',
      submitting: false,
      warning: ''
    });
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest('.nodel-add-node-toggle')) {
      event.preventDefault();
      void this.togglePanel();
      return;
    }

    if (target.closest('.nodel-add-node-cancel')) {
      event.preventDefault();
      if (this.state.submitting) {
        this.setState({ status: 'Canceling operation...' });
        this.cancelOperation();
        return;
      }
      this.closePanel();
      return;
    }

    const result = target.closest<HTMLElement>('[data-template-result-index]');
    if (result && this.contains(result)) {
      event.preventDefault();
      this.selectResult(Number(result.dataset.templateResultIndex));
      return;
    }

    if (this.state.showAutocomplete && !target.closest('.nodel-add-node-combobox')) {
      this.setState({ showAutocomplete: false });
    }
  };

  private handleSubmit = (event: Event) => {
    if (!(event.target instanceof HTMLFormElement) || !this.contains(event.target)) {
      return;
    }

    event.preventDefault();
    void this.submit();
  };

  private handleTemplateQueryChange = () => {
    if (!this.state.open) {
      return;
    }

    const selectionValue = this.selection?.type === 'recipe' ? this.selection.path : this.selection?.type === 'node' ? this.selection.name : null;
    if (selectionValue !== null && this.state.templateQuery === selectionValue) {
      return;
    }

    this.selection = null;
    this.selectedRecipe = null;
    this.setState({
      duplicateMode: false,
      includeNodeConfig: false,
      showSelection: false,
      selectionText: ''
    });
    this.scheduleSearch();
  };

  private handleKeydown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.matches('.nodel-add-node-name') && event.key === 'Enter') {
      event.preventDefault();
      void this.submit();
      return;
    }

    if (event.key === 'Escape') {
      const autocomplete = target.matches('.nodel-add-node-template')
        ? this.querySelector<HTMLElement>('.nodel-template-autocomplete')
        : null;
      if (autocomplete && !autocomplete.classList.contains('hidden') && getPopoverOptions(autocomplete, '.nodel-menu-item').length > 0) {
        event.preventDefault();
        clearActivePopoverOption(autocomplete, '.nodel-menu-item');
        this.setState({ showAutocomplete: false });
        return;
      }

      this.closePanel();
      return;
    }

    if (!target.matches('.nodel-add-node-template')) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const autocomplete = this.showTemplateAutocompleteIfOptions();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (moveActivePopoverOption(autocomplete, '.nodel-menu-item', direction)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'Enter') {
      const autocomplete = this.querySelector<HTMLElement>('.nodel-template-autocomplete');
      if (activateActivePopoverOption(autocomplete, '.nodel-menu-item')) {
        event.preventDefault();
      }
      return;
    }

  };

  private handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!this.state.open || !(target instanceof Element) || !target.isConnected) {
      return;
    }

    if (target.closest('.nodel-add-node-toggle, .nodel-add-node-panel') && this.contains(target)) {
      return;
    }

    this.closePanel();
  };

  private async togglePanel() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const open = !this.state.open;
    if (!open) {
      this.closePanel();
      return;
    }

    this.setState({ open: true });

    this.selection = null;
    this.selectedRecipe = null;
    this.templateResults = [];
    this.setState({
      createdUrl: '',
      duplicateMode: false,
      error: '',
      failedFiles: [],
      nodeName: '',
      hasNodeResults: false,
      hasRecipeResults: false,
      includeNodeConfig: false,
      nodeResults: [],
      recipeResults: [],
      selectionText: '',
      showAutocomplete: false,
      showSelection: false,
      status: '',
      templateQuery: '',
      warning: ''
    });

    const ticket = this.operations.begin('open', scope.signal);
    try {
      await refreshAddNodeRecipes(true, { signal: ticket.signal });
    } catch (error) {
      if (scope.isCurrent() && ticket.isCurrent() && this.state.open) {
        this.setState({ error: boundedErrorMessage(error, 'Template lookup failed') });
      }
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (scope.isCurrent() && current && this.state.open) {
        this.querySelector<HTMLInputElement>('.nodel-add-node-name')?.focus();
      }
    }
  }

  private closePanel() {
    this.invalidateSearch();
    this.setState({ open: false, showAutocomplete: false });
  }

  private scheduleSearch() {
    this.invalidateSearch();
    const scope = this.lifecycle.current;
    this.debounceTimer = scope?.setTimeout(() => {
      this.debounceTimer = null;
      void this.searchTemplates();
    }, debounceMs) ?? null;
  }

  private async searchTemplates() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    this.operations.invalidate('open');
    const query = this.state.templateQuery.trim();

    if (!query) {
      this.refreshResultViews([]);
      this.setState({ error: '' });
      return;
    }

    const ticket = this.operations.begin('search', scope.signal);
    const originalQuery = this.state.templateQuery;
    try {
      const result = await searchAddNodeTemplates({
        allowDuplicate: this.allowDuplicate,
        allowRecipes: this.allowRecipes,
        query,
        signal: ticket.signal
      });

      if (!scope.isCurrent() || !ticket.isCurrent() || this.state.templateQuery !== originalQuery) {
        return;
      }

      this.refreshResultViews(result.results);
      this.setState({ error: result.error, showAutocomplete: result.results.length > 0 });
    } finally {
      ticket.finish();
    }
  }

  private refreshResultViews(results: TemplateResult[]) {
    this.templateResults = results;
    const { nodeViews, recipeViews } = templateResultViews(results);
    getJQuery().observable(this.state.recipeResults).refresh(recipeViews);
    getJQuery().observable(this.state.nodeResults).refresh(nodeViews);
    this.setState({
      hasNodeResults: nodeViews.length > 0,
      hasRecipeResults: recipeViews.length > 0,
      showAutocomplete: nodeViews.length > 0 || recipeViews.length > 0,
      showSelection: false
    });
  }

  private showTemplateAutocompleteIfOptions() {
    const autocomplete = this.querySelector<HTMLElement>('.nodel-template-autocomplete');
    if (!autocomplete || autocomplete.querySelectorAll('.nodel-menu-item').length === 0) {
      return null;
    }

    this.setState({ showAutocomplete: true });
    return autocomplete;
  }

  private selectResult(index: number) {
    const result = this.templateResults[index];
    if (!result) {
      return;
    }

    if (result.type === 'recipe') {
      if (!result.recipe || !isCurrentAddNodeRecipe(result.recipe)) {
        return;
      }
      this.selection = { type: 'recipe', path: result.path };
      this.selectedRecipe = result.recipe;
      this.setState({
        createdUrl: '',
        duplicateMode: false,
        failedFiles: [],
        includeNodeConfig: false,
        selectionText: `Recipe: ${result.path || '(root recipe)'}`,
        showAutocomplete: false,
        showSelection: true,
        templateQuery: result.path,
        warning: ''
      });
      return;
    }

    this.selection = { type: 'node', address: result.address, name: result.name, host: result.host };
    this.selectedRecipe = null;
    this.setState({
      createdUrl: '',
      duplicateMode: true,
      failedFiles: [],
      includeNodeConfig: false,
      selectionText: `Node: ${result.name}`,
      showAutocomplete: false,
      showSelection: true,
      templateQuery: result.name,
      warning: ''
    });
  }

  private async submit() {
    const scope = this.lifecycle.current;
    if (!scope || this.state.submitting) {
      return;
    }
    const rawName = this.state.nodeName;
    const name = trimNodeName(rawName);
    const templateValue = this.state.templateQuery.trim();

    if (!name) {
      this.setState({ error: 'Please enter a node name', status: '' });
      return;
    }
    if (!isUsableNodeName(rawName)) {
      this.setState({ error: nodeNameValidationError(rawName), status: '' });
      return;
    }

    let selectedRecipe = this.selection?.type === 'recipe' ? this.selectedRecipe : null;
    if (this.selection?.type === 'recipe'
      && (!selectedRecipe || selectedRecipe.path !== this.selection.path)) {
      this.setState({ error: 'The selected recipe is no longer available. Select it again before creating a node.', status: '' });
      return;
    }
    if (!selectedRecipe && templateValue && nodeRecipePathCompatibility(templateValue) !== 'portable') {
      this.setState({ error: 'New recipe paths must use the portable relative path policy.', status: '' });
      return;
    }

    getJQuery().observable(this.state.failedFiles).refresh([]);
    this.setState({ createdUrl: '', error: '', status: '', submitting: true, warning: '' });
    const ticket = this.operations.begin('submit', scope.signal);
    this.submitGeneration = ticket.generation;
    this.canceledSubmitGeneration = null;

    try {
      let url = '';

      if (this.selection?.type === 'node' && this.allowDuplicate) {
        this.setState({ status: 'Duplicating node...' });
        const result = await duplicateAddNodeFromSource({
          sourceAddress: this.selection.address,
          name,
          includeNodeConfig: this.state.includeNodeConfig,
          signal: ticket.signal,
          onProgress: (progress) => {
            if (scope.isCurrent() && ticket.isCurrent()) {
              this.setState({ status: progress.message });
            }
          }
        });
        if (!scope.isCurrent()) {
          return;
        }
        url = result.url;
        if (!scope.isCurrent() || !ticket.isCurrent()) {
          return;
        }
        const skippedDetails = result.skippedDetails ?? [];
        if (result.failed.length > 0 || skippedDetails.length > 0) {
          getJQuery().observable(this.state.failedFiles).refresh(result.failed);
          this.setState({
            createdUrl: url,
            status: '',
            warning: skippedDetails.length > 0
              ? `Node "${name}" was created, but ${skippedDetails.length} legacy file${skippedDetails.length === 1 ? '' : 's'} was skipped because legacy paths cannot be copied safely. The node may be incomplete.`
              : `Node "${name}" was created, but ${result.failed.length} file${result.failed.length === 1 ? '' : 's'} could not be copied. The node may be incomplete.`
          });
          this.dispatchEvent(new CustomEvent('nodel-node-duplicate-partial', {
            bubbles: true,
            detail: result
          }));
          return;
        }
      } else {
        if (selectedRecipe) {
          // The cache can expire while the menu is open. Refresh immediately
          // before the mutation and use only the freshly decoded capability.
          const recipes = await refreshAddNodeRecipes(true, { signal: ticket.signal });
          if (!scope.isCurrent() || !ticket.isCurrent()) {
            return;
          }
          selectedRecipe = addNodeRecipeFromSnapshot(recipes, selectedRecipe);
          if (!selectedRecipe) {
            throw new Error('The selected recipe is no longer available. Select it again before creating a node.');
          }
        }
        const base = selectedRecipe ?? (templateValue || undefined);
        this.setState({ status: 'Creating node...' });
        const result = await createAddNodeFromTemplate({
          name,
          ...(base ? { base } : {}),
          signal: ticket.signal,
          onWaiting: () => {
            if (scope.isCurrent() && ticket.isCurrent()) {
              this.setState({ status: 'Waiting for node to become available...' });
            }
          }
        });
        url = result.url;
        if (!scope.isCurrent() || !ticket.isCurrent()) {
          return;
        }
      }

      if (!scope.isCurrent() || !ticket.isCurrent()) {
        return;
      }
      this.dispatchEvent(new CustomEvent('nodel-node-created', { bubbles: true, detail: { url } }));
      if (this.allowRedirect) {
        if (!scope.isCurrent() || !ticket.isCurrent()) {
          return;
        }
        const redirectUrl = safeNavigationHref(url);
        if (!redirectUrl) {
          throw new Error('Created node URL is invalid');
        }
        window.location.href = redirectUrl;
        this.closePanel();
      } else {
        this.setState({ createdUrl: url, status: 'Node created' });
      }
    } catch (error) {
      const destinationUrl = error instanceof NodelDuplicateNodeError ? error.destinationUrl : '';
      const incompleteDuplicate = error instanceof NodelDuplicateNodeError && Boolean(destinationUrl);
      const ownsCanceledIncompleteDuplicate = incompleteDuplicate
        && this.canceledSubmitGeneration === ticket.generation
        && this.submitGeneration === ticket.generation;
      if (!scope.isCurrent() || (!ticket.isCurrent() && !ownsCanceledIncompleteDuplicate)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Node add failed';
      if (isAbortError(error) && !destinationUrl) {
        return;
      }
      if (error instanceof NodelDuplicateNodeError) {
        getJQuery().observable(this.state.failedFiles).refresh(error.failed);
      }
      this.setState({
        createdUrl: destinationUrl,
        error: message,
        status: ''
      });
      const detail: { error: string; name: string; url?: string } = { error: message, name };
      if (destinationUrl) {
        detail.url = destinationUrl;
      }
      this.dispatchEvent(new CustomEvent('nodel-add-node-error', {
        bubbles: true,
        detail
      }));
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (scope.isCurrent() && current) {
        this.setState({ submitting: false });
      }
      if (this.submitGeneration === ticket.generation) {
        this.submitGeneration = null;
      }
    }
  }

  private setState(values: Partial<AddNodeViewModel>) {
    if (this.linked) {
      getJQuery().observable(this.state).setProperty(values);
    } else {
      Object.assign(this.state, values);
    }
  }
}

if (!customElements.get('nodel-add-node')) {
  customElements.define('nodel-add-node', NodelAddNode);
}
