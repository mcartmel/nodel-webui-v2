import { getVerySimpleName } from '../utils/node-name';
import type {
  NodelBuildInfo,
  NodelDiagnosticsResponse,
  NodelLocalNodeEntry,
  NodelLocalRestResponse,
  NodelNodeUrlEntry,
  NodelRecipeEntry
} from './nodel-types';

export interface NodelReachabilityResult {
  host: string;
  reachable: boolean;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(input: RequestInfo | URL, body: unknown, init?: RequestInit): Promise<T> {
  return fetchJson<T>(input, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(body)
  });
}

async function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForNodeReady(nodeUrl: string, attempts = 30, intervalMs = 1000): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${nodeUrl}REST/`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep retrying
    }

    await wait(intervalMs);
  }

  throw new Error('Timed out waiting for node to be ready');
}

export async function getLocalRest(init?: RequestInit): Promise<NodelLocalRestResponse> {
  return fetchJson<NodelLocalRestResponse>('/REST', init);
}

export async function getDiagnostics(init?: RequestInit): Promise<NodelDiagnosticsResponse> {
  return fetchJson<NodelDiagnosticsResponse>('/REST/diagnostics', init);
}

export async function getBuildInfo(init?: RequestInit): Promise<NodelBuildInfo> {
  return fetchJson<NodelBuildInfo>('/build.json', init);
}

export async function searchNodeUrls(filter: string, init?: RequestInit): Promise<NodelNodeUrlEntry[]> {
  return postJson<NodelNodeUrlEntry[]>('/REST/nodeURLs', { filter }, init);
}

export async function listRecipes(): Promise<NodelRecipeEntry[]> {
  return fetchJson<NodelRecipeEntry[]>('/REST/recipes/list');
}

export async function createNode(value: string, base?: string): Promise<unknown> {
  const payload: Record<string, string> = { value };
  if (base) {
    payload.base = base;
  }

  return postJson('/REST/newNode', payload);
}

export async function duplicateNode(sourceNodeUrl: string, newNodeName: string, progressCallback?: (message: string) => void): Promise<string> {
  const files = await fetchJson<Array<{ path: string }>>(`${sourceNodeUrl}REST/files`);
  await createNode(newNodeName);
  const newNodeUrl = `${window.location.origin}/nodes/${encodeURIComponent(getVerySimpleName(newNodeName))}/`;

  await waitForNodeReady(newNodeUrl);

  if (files.length === 0) {
    return newNodeUrl;
  }

  progressCallback?.('Initializing node...');

  for (const file of files) {
    const fileResponse = await fetch(`${sourceNodeUrl}REST/files/contents?path=${encodeURIComponent(file.path)}`);
    if (!fileResponse.ok) {
      throw new Error(`Failed to read ${file.path}`);
    }

    const content = await fileResponse.text();
    const saveUrl = `${newNodeUrl}REST/files/save?path=${encodeURIComponent(file.path)}`;
    const saveResponse = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: content
    });

    if (!saveResponse.ok) {
      throw new Error(`Failed to copy ${file.path}`);
    }
  }

  return newNodeUrl;
}

export async function checkHostReachable(host: string, timeoutMs = 3000, signal?: AbortSignal): Promise<NodelReachabilityResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`//${host}/REST`, {
      signal: controller.signal
    });
    return { host, reachable: response.ok || response.type === 'opaque' };
  } catch {
    return { host, reachable: false };
  } finally {
    window.clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
