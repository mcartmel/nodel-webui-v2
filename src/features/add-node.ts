import { listRecipes, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelNodeUrlEntry, NodelRecipeEntry } from '../api/nodel-types';
import { boundedErrorMessage, isAbortError } from '../utils/errors';
import { safeRemoteNodeUrl } from '../utils/urls';

export type AddNodeSelection =
  | { type: 'recipe'; path: string }
  | { type: 'node'; address: string; name: string; host: string }
  | null;

interface RecipeCache {
  data: NodelRecipeEntry[] | null;
  fetchedAt: number;
}

export type TemplateResult =
  | { type: 'recipe'; path: string }
  | { type: 'node'; address: string; name: string; host: string };

export type TemplateResultView = TemplateResult & {
  index: number;
  primary: string;
  secondary: string;
};

interface TemplateSearchOptions {
  allowDuplicate: boolean;
  allowRecipes: boolean;
  query: string;
  signal?: AbortSignal;
}

interface TemplateSearchResult {
  error: string;
  results: TemplateResult[];
}

const recipeCache: RecipeCache = {
  data: null,
  fetchedAt: 0
};

const recipeCacheTtlMs = 60 * 1000;
let recipeCacheGeneration = 0;

export async function refreshAddNodeRecipes(force = false, init?: RequestInit) {
  const now = Date.now();
  if (!force && recipeCache.data && now - recipeCache.fetchedAt < recipeCacheTtlMs) {
    return recipeCache.data;
  }

  const generation = ++recipeCacheGeneration;
  const data = await listRecipes(init);
  const result = data || [];
  if (!init?.signal?.aborted && generation === recipeCacheGeneration) {
    recipeCache.data = result;
    recipeCache.fetchedAt = Date.now();
  }
  return result;
}

function normalizeNodeResult(node: NodelNodeUrlEntry): Extract<TemplateResult, { type: 'node' }> | null {
  const url = safeRemoteNodeUrl(node.address);
  if (!url) {
    return null;
  }
  const address = url.href;
  const name = node.name || node.node || '';
  const host = node.host || url.host;
  return { type: 'node', address, name, host };
}

export async function searchAddNodeTemplates(options: TemplateSearchOptions): Promise<TemplateSearchResult> {
  const query = options.query.trim();
  if (!query) {
    return { error: '', results: [] };
  }

  const recipesPromise = options.allowRecipes ? refreshAddNodeRecipes(false, { signal: options.signal }) : Promise.resolve([] as NodelRecipeEntry[]);
  const nodesPromise = searchNodeUrls(query, { signal: options.signal });
  const [recipesResult, nodesResult] = await Promise.allSettled([recipesPromise, nodesPromise]);
  const failures = [recipesResult, nodesResult]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected' && !isAbortError(result.reason));

  if (recipesResult.status === 'rejected' && nodesResult.status === 'rejected') {
    return { error: boundedErrorMessage(recipesResult.reason, 'Template lookup failed'), results: [] };
  }

  const recipes = recipesResult.status === 'fulfilled' ? recipesResult.value : [];
  const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value : [];
  const searchLower = query.toLocaleLowerCase();
  const recipeResults = recipes
    .filter((recipe) => recipe.path.toLocaleLowerCase().includes(searchLower))
    .slice(0, 10)
    .map((recipe) => ({ type: 'recipe' as const, path: recipe.path }));
  const nodeResults = options.allowDuplicate
    ? nodes
        .filter((node) => (node.name || node.node || '').toLocaleLowerCase().includes(searchLower))
        .slice(0, 10)
        .map((node) => normalizeNodeResult(node))
        .filter((node): node is Extract<TemplateResult, { type: 'node' }> => node !== null)
    : [];

  return {
    error: failures.length > 0 ? boundedErrorMessage(failures[0].reason, 'Template lookup failed') : '',
    results: [...recipeResults, ...nodeResults]
  };
}

export function templateResultViews(results: TemplateResult[]) {
  const views = results.map((result, index): TemplateResultView => ({
    ...result,
    index,
    primary: result.type === 'recipe' ? result.path : result.name,
    secondary: result.type === 'recipe' ? 'Recipe' : result.host
  }));

  return {
    nodeViews: views.filter((result) => result.type === 'node'),
    recipeViews: views.filter((result) => result.type === 'recipe')
  };
}
