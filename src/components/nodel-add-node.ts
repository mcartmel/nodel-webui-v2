import { createNode, duplicateNode, listRecipes, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelNodeUrlEntry, NodelRecipeEntry } from '../api/nodel-types';
import { getVerySimpleName } from '../utils/node-name';
import { escapeHtml } from '../utils/html';

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

const recipeCache: RecipeCache = {
  data: null,
  fetchedAt: 0,
  promise: null
};

const recipeCacheTtlMs = 60 * 1000;
const debounceMs = 200;

function buildResultLabel(primary: string, secondary?: string) {
  return `${escapeHtml(primary)}${secondary ? `<br><span>${escapeHtml(secondary)}</span>` : ''}`;
}

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
  private open = false;
  private debounceTimer: number | null = null;
  private searchToken = 0;
  private selection: Selection = null;
  private templateResults: TemplateResult[] = [];

  connectedCallback() {
    this.connected = true;
    this.render();
    this.bindEvents();
  }

  disconnectedCallback() {
    this.connected = false;
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    document.removeEventListener('click', this.handleDocumentClick);
  }

  attributeChangedCallback() {
    if (this.connected) {
      this.render();
      this.bindEvents();
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

  private render() {
    this.innerHTML = `
      <div class="nodel-add-node space-y-3">
        <button type="button" class="nodel-add-node-toggle nodel-button" aria-expanded="false">
          Add node here
        </button>

        <div class="nodel-add-node-panel nodel-panel hidden p-4">
          <form class="space-y-4" novalidate>
            <div class="space-y-2">
              <label class="text-sm font-medium text-[rgb(var(--nodel-fg))]" for="nodel-add-node-name">Node name</label>
              <input id="nodel-add-node-name" class="nodel-add-node-name nodel-field w-full" type="text" autocomplete="off" />
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-[rgb(var(--nodel-fg))]" for="nodel-add-node-template">Template <small class="text-[rgb(var(--nodel-muted))]">(optional)</small></label>
              <div class="relative">
                <input id="nodel-add-node-template" class="nodel-add-node-template nodel-field w-full" type="text" placeholder="Search recipes or nodes..." autocomplete="off" />
                <div class="nodel-template-selected nodel-card mt-2 hidden px-3 py-2 text-sm text-[rgb(var(--nodel-muted))]"></div>
                <div class="nodel-template-autocomplete nodel-popover mt-2 hidden">
                  <ul class="divide-y divide-[rgb(var(--nodel-border))]"></ul>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3">
              <p class="nodel-add-node-status text-sm text-[rgb(var(--nodel-muted))]"></p>
              <button type="submit" class="nodeaddsubmit nodel-button nodel-button-primary">Add</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    const toggle = this.querySelector<HTMLButtonElement>('.nodel-add-node-toggle');
    const panel = this.querySelector<HTMLElement>('.nodel-add-node-panel');
    const form = this.querySelector<HTMLFormElement>('form');
    const nameInput = this.querySelector<HTMLInputElement>('.nodel-add-node-name');
    const templateInput = this.querySelector<HTMLInputElement>('.nodel-add-node-template');
    const autocomplete = this.querySelector<HTMLElement>('.nodel-template-autocomplete');
    const selection = this.querySelector<HTMLElement>('.nodel-template-selected');
    const status = this.querySelector<HTMLElement>('.nodel-add-node-status');

    toggle?.removeEventListener('click', this.handleToggleClick);
    toggle?.addEventListener('click', this.handleToggleClick);

    form?.removeEventListener('submit', this.handleSubmit);
    form?.addEventListener('submit', this.handleSubmit);

    templateInput?.removeEventListener('input', this.handleTemplateInput);
    templateInput?.addEventListener('input', this.handleTemplateInput);

    templateInput?.removeEventListener('keydown', this.handleTemplateKeydown);
    templateInput?.addEventListener('keydown', this.handleTemplateKeydown);

    document.removeEventListener('click', this.handleDocumentClick);
    document.addEventListener('click', this.handleDocumentClick);

    if (!this.open) {
      panel?.classList.add('hidden');
      toggle?.setAttribute('aria-expanded', 'false');
    }

    if (status) {
      status.textContent = '';
    }

    if (selection) {
      selection.classList.add('hidden');
      selection.textContent = '';
    }

    if (autocomplete) {
      autocomplete.classList.add('hidden');
    }

    nameInput?.removeEventListener('keydown', this.handleNameKeydown);
    nameInput?.addEventListener('keydown', this.handleNameKeydown);
  }

  private handleToggleClick = async () => {
    this.open = !this.open;
    const panel = this.querySelector<HTMLElement>('.nodel-add-node-panel');
    const toggle = this.querySelector<HTMLButtonElement>('.nodel-add-node-toggle');
    const nameInput = this.querySelector<HTMLInputElement>('.nodel-add-node-name');
    const templateInput = this.querySelector<HTMLInputElement>('.nodel-add-node-template');

    if (panel) {
      panel.classList.toggle('hidden', !this.open);
    }
    toggle?.setAttribute('aria-expanded', String(this.open));

    if (this.open) {
      this.selection = null;
      if (nameInput) {
        nameInput.value = '';
      }
      if (templateInput) {
        templateInput.value = '';
      }
      this.renderSelection(null);
      this.renderResults([]);
      await refreshRecipes(true);
      nameInput?.focus();
    }
  };

  private handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || this.contains(target)) {
      return;
    }

    this.closePanel();
  };

  private closePanel() {
    this.open = false;
    this.querySelector<HTMLElement>('.nodel-add-node-panel')?.classList.add('hidden');
    this.querySelector<HTMLButtonElement>('.nodel-add-node-toggle')?.setAttribute('aria-expanded', 'false');
    this.querySelector<HTMLElement>('.nodel-template-autocomplete')?.classList.add('hidden');
  }

  private handleTemplateKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.closePanel();
    }
  };

  private handleNameKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.submit();
    }
  };

  private handleTemplateInput = () => {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.searchTemplates();
    }, debounceMs);
  };

  private async searchTemplates() {
    const token = ++this.searchToken;
    const query = this.querySelector<HTMLInputElement>('.nodel-add-node-template')?.value.trim() ?? '';
    const autocomplete = this.querySelector<HTMLElement>('.nodel-template-autocomplete');

    if (!query) {
      this.renderResults([]);
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

    this.templateResults = [...recipeResults, ...nodeResults];
    this.renderResults(this.templateResults);
    autocomplete?.classList.remove('hidden');
  }

  private normalizeNodeResult(node: NodelNodeUrlEntry): { type: 'node'; address: string; name: string; host: string } {
    const address = node.address;
    const name = node.name || node.node || '';
    const host = node.host || new URL(address).host;
    return { type: 'node', address, name, host };
  }

  private renderResults(results: TemplateResult[]) {
    const autocomplete = this.querySelector<HTMLElement>('.nodel-template-autocomplete');
    const list = this.querySelector<HTMLUListElement>('.nodel-template-autocomplete ul');
    const selection = this.querySelector<HTMLElement>('.nodel-template-selected');

    if (!autocomplete || !list) {
      return;
    }

    list.innerHTML = '';

    if (results.length === 0) {
      autocomplete.classList.add('hidden');
      return;
    }

    const recipes = results.filter((item) => item.type === 'recipe') as Array<{ type: 'recipe'; path: string }>;
    const nodes = results.filter((item) => item.type === 'node') as Array<{ type: 'node'; address: string; name: string; host: string }>;

    if (recipes.length > 0) {
      const header = document.createElement('li');
      header.className = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--nodel-muted))]';
      header.textContent = 'Recipes';
      list.appendChild(header);

      for (const recipe of recipes) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nodel-menu-item';
        button.innerHTML = buildResultLabel(recipe.path, 'Recipe');
        button.addEventListener('click', () => this.selectRecipe(recipe.path));
        item.appendChild(button);
        list.appendChild(item);
      }
    }

    if (nodes.length > 0) {
      const header = document.createElement('li');
      header.className = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--nodel-muted))]';
      header.textContent = 'Existing Nodes';
      list.appendChild(header);

      for (const node of nodes) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nodel-menu-item';
        button.innerHTML = buildResultLabel(node.name, node.host);
        button.addEventListener('click', () => this.selectNode(node.address, node.name, node.host));
        item.appendChild(button);
        list.appendChild(item);
      }
    }

    autocomplete.classList.remove('hidden');
    selection?.classList.add('hidden');
  }

  private renderSelection(selection: Selection) {
    const selectionEl = this.querySelector<HTMLElement>('.nodel-template-selected');
    if (!selectionEl) {
      return;
    }

    if (!selection) {
      selectionEl.classList.add('hidden');
      selectionEl.textContent = '';
      return;
    }

    selectionEl.classList.remove('hidden');
    selectionEl.textContent = selection.type === 'recipe' ? `Recipe: ${selection.path}` : `Node: ${selection.name}`;
  }

  private selectRecipe(path: string) {
    this.selection = { type: 'recipe', path };
    this.renderSelection(this.selection);
    this.querySelector<HTMLInputElement>('.nodel-add-node-template')!.value = path;
    this.querySelector<HTMLElement>('.nodel-template-autocomplete')?.classList.add('hidden');
  }

  private selectNode(address: string, name: string, host: string) {
    this.selection = { type: 'node', address, name, host };
    this.renderSelection(this.selection);
    this.querySelector<HTMLInputElement>('.nodel-add-node-template')!.value = name;
    this.querySelector<HTMLElement>('.nodel-template-autocomplete')?.classList.add('hidden');
  }

  private handleSubmit = (event: Event) => {
    event.preventDefault();
    void this.submit();
  };

  private async submit() {
    const button = this.querySelector<HTMLButtonElement>('.nodeaddsubmit');
    const nameInput = this.querySelector<HTMLInputElement>('.nodel-add-node-name');
    const templateInput = this.querySelector<HTMLInputElement>('.nodel-add-node-template');
    const status = this.querySelector<HTMLElement>('.nodel-add-node-status');
    const name = nameInput?.value.trim() ?? '';
    const templateValue = templateInput?.value.trim() ?? '';

    if (!name) {
      if (status) {
        status.textContent = 'Please enter a node name';
      }
      return;
    }

    if (button) {
      button.disabled = true;
    }

    try {
      let url = '';

      if (this.selection?.type === 'node' && this.allowDuplicate) {
        if (status) {
          status.textContent = 'Duplicating node...';
        }
        url = await duplicateNode(this.selection.address, name);
      } else {
        const base = this.selection?.type === 'recipe' ? this.selection.path : templateValue;
        if (status) {
          status.textContent = 'Creating node...';
        }
        await createNode(name, base || undefined);
        url = `/nodes/${encodeURIComponent(getVerySimpleName(name))}/`;
      }

      this.dispatchEvent(new CustomEvent('nodel-node-created', { bubbles: true, detail: { url } }));
      if (this.allowRedirect) {
        window.location.href = url;
      } else {
        if (status) {
          status.textContent = 'Node created';
        }
      }

      this.closePanel();
    } catch (error) {
      if (status) {
        status.textContent = error instanceof Error ? error.message : 'Node add failed';
      }
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }
}

if (!customElements.get('nodel-add-node')) {
  customElements.define('nodel-add-node', NodelAddNode);
}
