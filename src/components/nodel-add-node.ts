import { createNode, duplicateNode, listRecipes, NodelDuplicateNodeError, searchNodeUrls, waitForNodeReady } from '../api/nodel-host-client';
import type { NodelDuplicateFileFailure, NodelNodeUrlEntry, NodelRecipeEntry } from '../api/nodel-types';
import { linkTemplate, unlinkTemplate, getJQuery } from '../jsviews/jsviews-runtime';
import { getVerySimpleName } from '../utils/node-name';
import { activateActivePopoverOption, clearActivePopoverOption, getPopoverOptions, moveActivePopoverOption } from '../utils/popover-keyboard';

type Selection =
  | { type: 'recipe'; path: string }
  | { type: 'node'; address: string; name: string; host: string }
  | null;

interface RecipeCache {
  data: NodelRecipeEntry[] | null;
  fetchedAt: number;
  promise: Promise<NodelRecipeEntry[]> | null;
}

type TemplateResult =
  | { type: 'recipe'; path: string }
  | { type: 'node'; address: string; name: string; host: string };

type TemplateResultView = TemplateResult & {
  index: number;
  primary: string;
  secondary: string;
};

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

const recipeCache: RecipeCache = {
  data: null,
  fetchedAt: 0,
  promise: null
};

const recipeCacheTtlMs = 60 * 1000;
const debounceMs = 200;

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
            <button type="button" class="nodel-add-node-cancel nodel-button" data-link="disabled{:submitting}">Cancel</button>
            <button type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:submitting}">Add</button>
          </div>
        </div>
      </form>
    </div>
  </div>
`;

async function refreshRecipes(force = false) {
  const now = Date.now();
  if (!force && recipeCache.data && now - recipeCache.fetchedAt < recipeCacheTtlMs) {
    return recipeCache.data;
  }

  if (recipeCache.promise) {
    return recipeCache.promise;
  }

  recipeCache.promise = listRecipes()
    .then((data) => {
      recipeCache.data = data || [];
      recipeCache.fetchedAt = Date.now();
      return recipeCache.data;
    })
    .finally(() => {
      recipeCache.promise = null;
    });

  return recipeCache.promise;
}

export class NodelAddNode extends HTMLElement {
  static observedAttributes = ['redirect', 'recipes', 'duplicate'];

  private connected = false;
  private debounceTimer: number | null = null;
  private linked = false;
  private searchToken = 0;
  private selection: Selection = null;
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
    this.connected = true;
    void this.initialize();
  }

  disconnectedCallback() {
    this.connected = false;
    this.clearDebounceTimer();
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('submit', this.handleSubmit);
    this.querySelector<HTMLInputElement>('.nodel-add-node-name')?.removeEventListener('keydown', this.handleKeydown);
    this.querySelector<HTMLInputElement>('.nodel-add-node-template')?.removeEventListener('keydown', this.handleKeydown);
    this.unobserveControls();
    document.removeEventListener('click', this.handleDocumentClick);
    void unlinkTemplate(this);
    this.linked = false;
  }

  attributeChangedCallback() {
    if (this.connected) {
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

  private async initialize() {
    this.syncAttributeState();
    if (!this.linked) {
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.addEventListener('click', this.handleClick);
      this.addEventListener('submit', this.handleSubmit);
      document.addEventListener('click', this.handleDocumentClick);
      this.bindKeydownEvents();
      this.observeControls();
    }
  }

  private bindKeydownEvents() {
    this.querySelector<HTMLInputElement>('.nodel-add-node-name')?.addEventListener('keydown', this.handleKeydown);
    this.querySelector<HTMLInputElement>('.nodel-add-node-template')?.addEventListener('keydown', this.handleKeydown);
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

    const selectionValue = this.selection?.type === 'recipe' ? this.selection.path : this.selection?.type === 'node' ? this.selection.name : '';
    if (selectionValue && this.state.templateQuery === selectionValue) {
      return;
    }

    this.selection = null;
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
    const open = !this.state.open;
    this.setState({ open });

    if (open) {
      this.selection = null;
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
      await refreshRecipes(true);
      this.querySelector<HTMLInputElement>('.nodel-add-node-name')?.focus();
    }
  }

  private closePanel() {
    this.setState({ open: false, showAutocomplete: false });
  }

  private scheduleSearch() {
    this.clearDebounceTimer();
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.searchTemplates();
    }, debounceMs);
  }

  private async searchTemplates() {
    const token = ++this.searchToken;
    const query = this.state.templateQuery.trim();

    if (!query) {
      this.refreshResultViews([]);
      return;
    }

    const recipesPromise = this.allowRecipes ? refreshRecipes(false) : Promise.resolve([] as NodelRecipeEntry[]);
    const nodesPromise = searchNodeUrls(query);
    const [recipes, nodes] = await Promise.all([recipesPromise, nodesPromise]);

    if (token !== this.searchToken) {
      return;
    }

    const searchLower = query.toLocaleLowerCase();
    const recipeResults = (recipes || [])
      .filter((recipe) => recipe.path.toLocaleLowerCase().includes(searchLower))
      .slice(0, 10)
      .map((recipe) => ({ type: 'recipe' as const, path: recipe.path }));

    const nodeResults = this.allowDuplicate
      ? (nodes || [])
          .filter((node) => (node.name || node.node || '').toLocaleLowerCase().includes(searchLower))
          .slice(0, 10)
          .map((node) => this.normalizeNodeResult(node))
      : [];

    this.refreshResultViews([...recipeResults, ...nodeResults]);
  }

  private normalizeNodeResult(node: NodelNodeUrlEntry): { type: 'node'; address: string; name: string; host: string } {
    const address = node.address;
    const name = node.name || node.node || '';
    const host = node.host || new URL(address).host;
    return { type: 'node', address, name, host };
  }

  private refreshResultViews(results: TemplateResult[]) {
    this.templateResults = results;
    const views = results.map((result, index): TemplateResultView => ({
      ...result,
      index,
      primary: result.type === 'recipe' ? result.path : result.name,
      secondary: result.type === 'recipe' ? 'Recipe' : result.host
    }));

    const recipeViews = views.filter((result) => result.type === 'recipe');
    const nodeViews = views.filter((result) => result.type === 'node');
    getJQuery().observable(this.state.recipeResults).refresh(recipeViews);
    getJQuery().observable(this.state.nodeResults).refresh(nodeViews);
    this.setState({
      hasNodeResults: nodeViews.length > 0,
      hasRecipeResults: recipeViews.length > 0,
      showAutocomplete: views.length > 0,
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
      this.selection = { type: 'recipe', path: result.path };
      this.setState({
        createdUrl: '',
        duplicateMode: false,
        failedFiles: [],
        includeNodeConfig: false,
        selectionText: `Recipe: ${result.path}`,
        showAutocomplete: false,
        showSelection: true,
        templateQuery: result.path,
        warning: ''
      });
      return;
    }

    this.selection = { type: 'node', address: result.address, name: result.name, host: result.host };
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
    const name = this.state.nodeName.trim();
    const templateValue = this.state.templateQuery.trim();

    if (!name) {
      this.setState({ error: 'Please enter a node name', status: '' });
      return;
    }

    getJQuery().observable(this.state.failedFiles).refresh([]);
    this.setState({ createdUrl: '', error: '', status: '', submitting: true, warning: '' });

    try {
      let url = '';

      if (this.selection?.type === 'node' && this.allowDuplicate) {
        this.setState({ status: 'Duplicating node...' });
        const result = await duplicateNode(this.selection.address, name, {
          includeNodeConfig: this.state.includeNodeConfig,
          onProgress: (progress) => this.setState({ status: progress.message })
        });
        url = result.url;
        if (result.failed.length > 0) {
          getJQuery().observable(this.state.failedFiles).refresh(result.failed);
          this.setState({
            createdUrl: url,
            status: '',
            warning: `Node "${name}" was created, but ${result.failed.length} file${result.failed.length === 1 ? '' : 's'} could not be copied. The node may be incomplete.`
          });
          this.dispatchEvent(new CustomEvent('nodel-node-duplicate-partial', {
            bubbles: true,
            detail: result
          }));
          return;
        }
      } else {
        const base = this.selection?.type === 'recipe' ? this.selection.path : templateValue;
        this.setState({ status: 'Creating node...' });
        await createNode(name, base || undefined);
        url = `/nodes/${encodeURIComponent(getVerySimpleName(name))}/`;
        this.setState({ status: 'Waiting for node to become available...' });
        await waitForNodeReady(url);
      }

      this.dispatchEvent(new CustomEvent('nodel-node-created', { bubbles: true, detail: { url } }));
      if (this.allowRedirect) {
        window.location.href = url;
        this.closePanel();
      } else {
        this.setState({ createdUrl: url, status: 'Node created' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Node add failed';
      const destinationUrl = error instanceof NodelDuplicateNodeError ? error.destinationUrl : '';
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
      this.setState({ submitting: false });
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
