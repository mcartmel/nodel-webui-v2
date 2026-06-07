import { createNode, duplicateNode, listRecipes, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelNodeUrlEntry, NodelRecipeEntry } from '../api/nodel-types';
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
  duplicateEnabled: boolean;
  hasNodeResults: boolean;
  hasRecipeResults: boolean;
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
          <div class="relative">
            <input id="nodel-add-node-template" class="nodel-add-node-template nodel-field w-full" type="text" placeholder="Search recipes or nodes..." autocomplete="off" data-link="templateQuery trigger=true" />
            <div class="nodel-template-selected nodel-card mt-2 px-3 py-2 text-sm text-nodel-muted" data-link="class{:showSelection ? 'nodel-template-selected nodel-card mt-2 px-3 py-2 text-sm text-nodel-muted' : 'nodel-template-selected nodel-card mt-2 hidden px-3 py-2 text-sm text-nodel-muted'}">{^{>selectionText}}</div>
            <div class="nodel-template-autocomplete nodel-popover mt-2" data-link="class{:showAutocomplete ? 'nodel-template-autocomplete nodel-popover mt-2' : 'nodel-template-autocomplete nodel-popover mt-2 hidden'}">
              <ul class="divide-y divide-nodel-border">
                {^{if hasRecipeResults}}
                  <li class="nodel-section-heading px-3 py-2">Recipes</li>
                  {^{for recipeResults}}
                    <li>
                      <button type="button" class="nodel-menu-item" data-template-result-index="{{:index}}">
                        {^{>primary}}<br><span>{^{>secondary}}</span>
                      </button>
                    </li>
                  {{/for}}
                {{/if}}
                {^{if hasNodeResults}}
                  <li class="nodel-section-heading px-3 py-2">Existing Nodes</li>
                  {^{for nodeResults}}
                    <li>
                      <button type="button" class="nodel-menu-item" data-template-result-index="{{:index}}">
                        {^{>primary}}<br><span>{^{>secondary}}</span>
                      </button>
                    </li>
                  {{/for}}
                {{/if}}
              </ul>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3">
          <p class="nodel-add-node-status text-sm text-nodel-muted">{^{>status}}</p>
          <button type="submit" class="nodeaddsubmit nodel-button nodel-button-primary" data-link="disabled{:submitting}">Add</button>
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
    duplicateEnabled: true,
    hasNodeResults: false,
    hasRecipeResults: false,
    nodeName: '',
    open: false,
    recipeResults: [],
    nodeResults: [],
    selectionText: '',
    showAutocomplete: false,
    showSelection: false,
    status: '',
    submitting: false,
    templateQuery: ''
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
    this.setState({ duplicateEnabled: this.allowDuplicate });
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

    const result = target.closest<HTMLElement>('[data-template-result-index]');
    if (result && this.contains(result)) {
      event.preventDefault();
      this.selectResult(Number(result.dataset.templateResultIndex));
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
    this.setState({ showSelection: false, selectionText: '' });
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

    if (event.key === 'Escape') {
      const autocomplete = this.querySelector<HTMLElement>('.nodel-template-autocomplete');
      if (autocomplete && !autocomplete.classList.contains('hidden') && getPopoverOptions(autocomplete, '.nodel-menu-item').length > 0) {
        event.preventDefault();
        clearActivePopoverOption(autocomplete, '.nodel-menu-item');
        this.setState({ showAutocomplete: false });
        return;
      }

      this.closePanel();
    }
  };

  private handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || this.contains(target)) {
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
        nodeName: '',
        hasNodeResults: false,
        hasRecipeResults: false,
        nodeResults: [],
        recipeResults: [],
        selectionText: '',
        showAutocomplete: false,
        showSelection: false,
        status: '',
        templateQuery: ''
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
        selectionText: `Recipe: ${result.path}`,
        showAutocomplete: false,
        showSelection: true,
        templateQuery: result.path
      });
      return;
    }

    this.selection = { type: 'node', address: result.address, name: result.name, host: result.host };
    this.setState({
      selectionText: `Node: ${result.name}`,
      showAutocomplete: false,
      showSelection: true,
      templateQuery: result.name
    });
  }

  private async submit() {
    const name = this.state.nodeName.trim();
    const templateValue = this.state.templateQuery.trim();

    if (!name) {
      this.setState({ status: 'Please enter a node name' });
      return;
    }

    this.setState({ submitting: true });

    try {
      let url = '';

      if (this.selection?.type === 'node' && this.allowDuplicate) {
        this.setState({ status: 'Duplicating node...' });
        url = await duplicateNode(this.selection.address, name);
      } else {
        const base = this.selection?.type === 'recipe' ? this.selection.path : templateValue;
        this.setState({ status: 'Creating node...' });
        await createNode(name, base || undefined);
        url = `/nodes/${encodeURIComponent(getVerySimpleName(name))}/`;
      }

      this.dispatchEvent(new CustomEvent('nodel-node-created', { bubbles: true, detail: { url } }));
      if (this.allowRedirect) {
        window.location.href = url;
      } else {
        this.setState({ status: 'Node created' });
      }

      this.closePanel();
    } catch (error) {
      this.setState({ status: error instanceof Error ? error.message : 'Node add failed' });
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
