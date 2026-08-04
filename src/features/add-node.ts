import { listRecipes, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelNodeUrlEntry, NodelRecipeEntry } from '../api/nodel-types';
import { boundedErrorMessage, isAbortError } from '../utils/errors';
import { isDecodedNodeRecipeCapability } from '../utils/node-file-path';
import { safeRemoteNodeUrl } from '../utils/urls';

export type AddNodeSelection =
  | { type: 'recipe'; path: string }
  | { type: 'node'; address: string; name: string; host: string }
  | null;

interface RecipeCache {
  data: ReadonlyArray<NodelRecipeEntry> | null;
  fetchedAt: number;
}

export type TemplateResult =
  | { type: 'recipe'; path: string; recipe?: NodelRecipeEntry }
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
  const result = Object.freeze([...(data || [])]);
  if (!init?.signal?.aborted && generation === recipeCacheGeneration) {
    recipeCache.data = result;
    recipeCache.fetchedAt = Date.now();
  }
  return result;
}

/** A legacy recipe base is usable only while this exact decoded cache entry remains current. */
export function isCurrentAddNodeRecipe(recipe: NodelRecipeEntry) {
  return currentAddNodeRecipe(recipe) !== null;
}

/** Returns the exact currently listed capability matching a selected recipe. */
export function currentAddNodeRecipe(recipe: NodelRecipeEntry) {
  return addNodeRecipeFromSnapshot(recipeCache.data ?? [], recipe);
}

/** Returns the exact capability from one immutable recipe-list response. */
export function addNodeRecipeFromSnapshot(recipes: ReadonlyArray<NodelRecipeEntry>, recipe: NodelRecipeEntry) {
  if (!isDecodedNodeRecipeCapability(recipe)) {
    return null;
  }
  return recipes.find((candidate) => (
    candidate.path === recipe.path
    && candidate.compatibility === recipe.compatibility
    && isDecodedNodeRecipeCapability(candidate)
  )) ?? null;
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
    .filter((recipe) => recipe.path === '' || recipe.path.toLocaleLowerCase().includes(searchLower))
    .slice(0, 10)
    .map((recipe) => {
      const result: Extract<TemplateResult, { type: 'recipe' }> = { type: 'recipe', path: recipe.path };
      // Keep the decoded capability private to UI rendering while preserving
      // the existing public result view shape.
      Object.defineProperty(result, 'recipe', { value: recipe, enumerable: false });
      return result;
    });
  const nodeResults = options.allowDuplicate
    ? nodes
        .filter((node) => (node.name || node.node || '').toLocaleLowerCase().includes(searchLower))
        .map((node) => normalizeNodeResult(node))
        .filter((node): node is Extract<TemplateResult, { type: 'node' }> => node !== null)
        .slice(0, 10)
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
    primary: result.type === 'recipe' ? (result.path || '(root recipe)') : result.name,
    secondary: result.type === 'recipe' ? 'Recipe' : result.host
  }));

  return {
    nodeViews: views.filter((result) => result.type === 'node'),
    recipeViews: views.filter((result) => result.type === 'recipe')
  };
}
