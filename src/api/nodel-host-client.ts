import { getVerySimpleName } from '../utils/node-name';
import type {
  NodelActivityLogEntry,
  NodelActionDefinition,
  NodelConsoleLogEntry,
  NodelBuildInfo,
  NodelDiagnosticsResponse,
  NodelFileEntry,
  NodelLocalNodeEntry,
  NodelLocalRestResponse,
  NodelNodeRestResponse,
  NodelNodeUrlEntry,
  NodelRestartStatus,
  NodelRecipeEntry,
  NodelJsonSchema,
  NodelSignalDefinition
} from './nodel-types';

export interface NodelReachabilityResult {
  host: string;
  reachable: boolean;
}

export interface NodelCustomUiEntry {
  href: string;
  path: string;
  title: string;
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

async function fetchOk(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

async function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForNodeReady(nodeUrl: string, attempts = 30, intervalMs = 1000): Promise<void> {
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

export async function getNodeDetails(init?: RequestInit): Promise<NodelNodeRestResponse> {
  return fetchJson<NodelNodeRestResponse>('REST/', init);
}

export async function renameCurrentNode(value: string, init?: RequestInit): Promise<unknown> {
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

export async function getNodeRestartStatus(options: { timestamp?: string | null; timeout?: number } = {}, init?: RequestInit): Promise<NodelRestartStatus> {
  const params = new URLSearchParams();
  if (options.timestamp) {
    params.set('timestamp', options.timestamp);
  }
  if (options.timeout && options.timeout > 0) {
    params.set('timeout', String(options.timeout));
  }

  const query = params.toString();
  return fetchJson<NodelRestartStatus>(`REST/hasRestarted${query ? `?${query}` : ''}`, init);
}

export async function getNodeConsoleLogs(options: { from: number; max: number; timeout?: number }, init?: RequestInit): Promise<NodelConsoleLogEntry[]> {
  const timeout = options.timeout ?? 0;
  return fetchJson<NodelConsoleLogEntry[]>(`REST/console?from=${options.from}&max=${options.max}${timeout > 0 ? `&timeout=${timeout}` : ''}`, init);
}

export async function executeNodeConsoleCommand(code: string, init?: RequestInit): Promise<unknown> {
  return postJson<unknown>('REST/exec', { code }, init);
}

export async function getNodeActivity(options: { from: number }, init?: RequestInit): Promise<NodelActivityLogEntry[]> {
  return fetchJson<NodelActivityLogEntry[]>(`REST/activity?from=${options.from}`, init);
}

export async function getNodeActions(init?: RequestInit): Promise<Record<string, NodelActionDefinition>> {
  return fetchJson<Record<string, NodelActionDefinition>>('REST/actions', init);
}

export async function getNodeSignals(init?: RequestInit): Promise<Record<string, NodelSignalDefinition>> {
  return fetchJson<Record<string, NodelSignalDefinition>>('REST/events', init);
}

export async function callNodeAction(name: string, payload: unknown, init?: RequestInit): Promise<unknown> {
  return postJson<unknown>(`REST/actions/${encodeURIComponent(name)}/call`, payload, init);
}

export async function emitNodeSignal(name: string, payload: unknown, init?: RequestInit): Promise<unknown> {
  return postJson<unknown>(`REST/events/${encodeURIComponent(name)}/emit`, payload, init);
}

export async function getNodeParamsSchema(init?: RequestInit): Promise<NodelJsonSchema> {
  return fetchJson<NodelJsonSchema>('REST/params/schema', init);
}

export async function getNodeParams(init?: RequestInit): Promise<Record<string, unknown>> {
  return fetchJson<Record<string, unknown>>('REST/params', init);
}

export async function saveNodeParams(payload: Record<string, unknown>, init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/params/save', {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(payload)
  });
}

export async function getNodeRemoteSchema(init?: RequestInit): Promise<NodelJsonSchema> {
  return fetchJson<NodelJsonSchema>('REST/remote/schema', init);
}

export async function getNodeRemoteBindings(init?: RequestInit): Promise<Record<string, unknown>> {
  return fetchJson<Record<string, unknown>>('REST/remote', init);
}

export async function saveNodeRemoteBindings(payload: Record<string, unknown>, init?: RequestInit): Promise<unknown> {
  return fetchOk('REST/remote/save', {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(payload)
  });
}

function restUrlForNode(nodeUrl: string, endpoint: string) {
  return `${nodeUrl.replace(/\/?$/, '/')}${endpoint}`;
}

export async function getRemoteNodeActions(nodeUrl: string, init?: RequestInit): Promise<Record<string, NodelActionDefinition>> {
  return fetchJson<Record<string, NodelActionDefinition>>(restUrlForNode(nodeUrl, 'REST/actions'), init);
}

export async function getRemoteNodeSignals(nodeUrl: string, init?: RequestInit): Promise<Record<string, NodelSignalDefinition>> {
  return fetchJson<Record<string, NodelSignalDefinition>>(restUrlForNode(nodeUrl, 'REST/events'), init);
}

export async function listNodeFiles(init?: RequestInit): Promise<NodelFileEntry[]> {
  return fetchJson<NodelFileEntry[]>('REST/files', init);
}

export function customUiEntriesFromFiles(files: NodelFileEntry[]): NodelCustomUiEntry[] {
  const excluded = new Set([
    'content/index.htm',
    'content/nodes.xml',
    'content/index-sample.xml',
    'content/index-sample.xml.htm'
  ]);

  return files
    .filter((file) => /^content\/\w+\.(xml|html|htm)$/i.test(file.path) && !excluded.has(file.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const title = file.path.replace(/^content\//, '');
      return {
        href: title,
        path: file.path,
        title
      };
    });
}

export async function listCustomUiEntries(init?: RequestInit): Promise<NodelCustomUiEntry[]> {
  return customUiEntriesFromFiles(await listNodeFiles(init));
}

export async function getNodeFileContents(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`REST/files/contents?path=${encodeURIComponent(path)}`, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

export async function saveNodeFile(path: string, content: BodyInit, init?: RequestInit): Promise<unknown> {
  if (path === 'script.py') {
    return postJson<unknown>('REST/script/save', { script: String(content) }, init);
  }

  return fetchOk(`REST/files/save?path=${encodeURIComponent(path)}`, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(init?.headers ?? {})
    },
    body: content
  });
}

export async function deleteNodeFile(path: string, init?: RequestInit): Promise<unknown> {
  return fetchOk(`REST/files/delete?path=${encodeURIComponent(path)}`, init);
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
