import { fetchOk, postJson } from './http-transport';
import type { NodelRecipeEntry } from './nodel-types';
import { decodedNodeRecipePath, isDecodedNodeRecipeCapability, nodeRecipePathCompatibility } from '../utils/node-file-path';
import { assertUsableNodeName } from '../utils/node-name';

export async function createNode(value: string, base?: string | NodelRecipeEntry, init?: RequestInit): Promise<unknown> {
  assertUsableNodeName(value);
  const payload: Record<string, string> = { value };
  if (base !== undefined) {
    if (typeof base === 'string') {
      if (base === '' || nodeRecipePathCompatibility(base) !== 'portable') {
        throw new Error('Legacy and root recipe bases require an exact selected recipe');
      }
      payload.base = base;
    } else {
      if (!isDecodedNodeRecipeCapability(base)) {
        throw new Error('Recipe base requires an exact decoded recipe entry');
      }
      const path = decodedNodeRecipePath(base);
      if (path === null) {
        throw new Error('Recipe base requires an exact decoded recipe entry');
      }
      payload.base = path;
    }
  }

  return postJson('/REST/newNode', payload, init);
}

export async function renameCurrentNode(value: string, init?: RequestInit): Promise<unknown> {
  assertUsableNodeName(value);
  return fetchOk('REST/rename', {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify({ value })
  });
}

export async function restartCurrentNode(init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/restart', init);
}

export async function removeCurrentNode(init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/remove?confirm=true', init);
}
