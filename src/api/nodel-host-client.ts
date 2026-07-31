import { getVerySimpleName } from '../utils/node-name';
import type {
  NodelActivityLogEntry,
  NodelActionDefinition,
  NodelCapabilities,
  NodelConsoleLogEntry,
  NodelBuildInfo,
  NodelCapabilityFeatures,
  NodelDiagnosticMeasurement,
  NodelDiagnosticsResponse,
  NodelDuplicateFileFailure,
  NodelDuplicateNodeOptions,
  NodelDuplicateNodeResult,
  NodelDuplicateProgress,
  NodelFileEntry,
  NodelHostLogEntry,
  NodelLocalNodeEntry,
  NodelLocalRestResponse,
  NodelNodeRestResponse,
  NodelNodeUrlEntry,
  NodelRestartStatus,
  NodelRecipeEntry,
  NodelJsonSchema,
  NodelSignalDefinition,
  NodelToolkitResponse
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

export class NodelDuplicateNodeError extends Error {
  readonly destinationUrl: string;
  readonly failed: NodelDuplicateFileFailure[];

  constructor(message: string, destinationUrl: string, failed: NodelDuplicateFileFailure[] = []) {
    super(message);
    this.name = 'NodelDuplicateNodeError';
    this.destinationUrl = destinationUrl;
    this.failed = failed;
  }
}

async function responseError(response: Response) {
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  let detail = '';

  try {
    const body = (await response.text()).trim();
    if (body) {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (typeof parsed === 'string') {
          detail = parsed;
        } else if (parsed !== null && typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>;
          const value = record.message ?? record.error;
          detail = typeof value === 'string' ? value : body;
        } else {
          detail = body;
        }
      } catch {
        detail = body;
      }
    }
  } catch {
    // Fall back to the HTTP status when the response body cannot be read.
  }

  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 500);
  return new Error(detail || status);
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await responseError(response);
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
    throw await responseError(response);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function legacyCapabilities(): NodelCapabilities {
  return {
    schemaVersion: null,
    apiVersion: null,
    features: {
      consoleExec: true
    }
  };
}

export function normalizeNodelCapabilities(value: unknown): NodelCapabilities {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.apiVersion !== 'string' || !isRecord(value.features)) {
    return legacyCapabilities();
  }

  const featureSource = value.features;
  const features: NodelCapabilityFeatures = { ...featureSource };
  if (typeof featureSource.consoleExec !== 'boolean') {
    features.consoleExec = true;
  }

  return {
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : null,
    apiVersion: typeof value.apiVersion === 'string' ? value.apiVersion : null,
    features
  };
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

export async function getHostCapabilities(init?: RequestInit): Promise<NodelCapabilities> {
  try {
    const response = await fetch('/REST/capabilities', init);
    if (!response.ok) {
      return legacyCapabilities();
    }

    return normalizeNodelCapabilities(await response.json());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    return legacyCapabilities();
  }
}

export async function getDiagnostics(init?: RequestInit): Promise<NodelDiagnosticsResponse> {
  return fetchJson<NodelDiagnosticsResponse>('/REST/diagnostics', init);
}

export async function getDiagnosticMeasurements(init?: RequestInit): Promise<NodelDiagnosticMeasurement[]> {
  return fetchJson<NodelDiagnosticMeasurement[]>('/REST/diagnostics/measurements', init);
}

export async function getBuildInfo(init?: RequestInit): Promise<NodelBuildInfo> {
  return fetchJson<NodelBuildInfo>('/build.json', init);
}

export async function getHostLogs(options: { from: number; max: number }, init?: RequestInit): Promise<NodelHostLogEntry[]> {
  return fetchJson<NodelHostLogEntry[]>(`/REST/logs?from=${options.from}&max=${options.max}`, init);
}

export async function getToolkit(init?: RequestInit): Promise<NodelToolkitResponse> {
  return fetchJson<NodelToolkitResponse>('/REST/toolkit', init);
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

function duplicateFileBasename(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function shouldCopyDuplicateFile(path: string, includeNodeConfig: boolean) {
  const basename = duplicateFileBasename(path);
  return !basename.startsWith('_')
    && !/^script_backup_.*\.py$/i.test(basename)
    && (includeNodeConfig || basename !== 'nodeConfig.json');
}

function validateDuplicateFileList(value: unknown): NodelFileEntry[] {
  if (!Array.isArray(value) || value.some((file) => !isRecord(file) || typeof file.path !== 'string' || !file.path.trim())) {
    throw new Error('Source node returned an invalid file list');
  }

  return value as NodelFileEntry[];
}

function boundedErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return (message.trim() || fallback).replace(/\s+/g, ' ').slice(0, 500);
}

async function duplicateFileFailure(path: string, phase: NodelDuplicateFileFailure['phase'], response: Response): Promise<NodelDuplicateFileFailure> {
  const error = await responseError(response);
  return {
    path,
    phase,
    status: response.status,
    message: boundedErrorMessage(error, `HTTP ${response.status}`)
  };
}

function networkDuplicateFileFailure(path: string, phase: NodelDuplicateFileFailure['phase'], error: unknown): NodelDuplicateFileFailure {
  return {
    path,
    phase,
    message: boundedErrorMessage(error, phase === 'read' ? 'Failed to read source file' : 'Failed to save destination file')
  };
}

function reportDuplicateProgress(options: NodelDuplicateNodeOptions, progress: NodelDuplicateProgress) {
  try {
    options.onProgress?.(progress);
  } catch {
    // UI progress must not interrupt a file copy.
  }
}

async function copyDuplicateFile(sourceNodeUrl: string, destinationNodeUrl: string, path: string): Promise<NodelDuplicateFileFailure | null> {
  let contents: Blob;
  try {
    const response = await fetch(restUrlForNode(sourceNodeUrl, `REST/files/contents?path=${encodeURIComponent(path)}`));
    if (!response.ok) {
      return duplicateFileFailure(path, 'read', response);
    }
    contents = await response.blob();
  } catch (error) {
    return networkDuplicateFileFailure(path, 'read', error);
  }

  try {
    const response = await fetch(restUrlForNode(destinationNodeUrl, `REST/files/save?path=${encodeURIComponent(path)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: contents
    });
    if (!response.ok) {
      return duplicateFileFailure(path, 'save', response);
    }
  } catch (error) {
    return networkDuplicateFileFailure(path, 'save', error);
  }

  return null;
}

export async function duplicateNode(sourceNodeUrl: string, newNodeName: string, options: NodelDuplicateNodeOptions = {}): Promise<NodelDuplicateNodeResult> {
  let files: NodelFileEntry[];
  try {
    const fileList = await fetchJson<unknown>(restUrlForNode(sourceNodeUrl, 'REST/files'));
    files = validateDuplicateFileList(fileList);
  } catch (error) {
    throw new Error(`Failed to read source node file list: ${boundedErrorMessage(error, 'source file list request failed')}`);
  }
  const includeNodeConfig = options.includeNodeConfig === true;
  const skipped = files.filter((file) => !shouldCopyDuplicateFile(file.path, includeNodeConfig)).map((file) => file.path);
  const filesToCopy = files
    .filter((file) => shouldCopyDuplicateFile(file.path, includeNodeConfig))
    .sort((left, right) => Number(left.path === 'script.py') - Number(right.path === 'script.py'));

  reportDuplicateProgress(options, {
    phase: 'creating',
    message: 'Creating destination node...',
    current: 0,
    total: filesToCopy.length
  });
  try {
    await createNode(newNodeName);
  } catch (error) {
    throw new Error(`Failed to create destination node "${newNodeName}": ${boundedErrorMessage(error, 'node creation failed')}`);
  }

  const newNodeUrl = `${window.location.origin}/nodes/${encodeURIComponent(getVerySimpleName(newNodeName))}/`;
  reportDuplicateProgress(options, {
    phase: 'waiting',
    message: 'Waiting for the destination node to become available...',
    current: 0,
    total: filesToCopy.length
  });

  try {
    await waitForNodeReady(newNodeUrl);
  } catch (error) {
    throw new NodelDuplicateNodeError(
      `Node "${newNodeName}" was created but may be incomplete because it did not become available: ${boundedErrorMessage(error, 'readiness check failed')}`,
      newNodeUrl
    );
  }

  const copied: string[] = [];
  const failed: NodelDuplicateFileFailure[] = [];
  for (const [index, file] of filesToCopy.entries()) {
    reportDuplicateProgress(options, {
      phase: 'copying',
      message: `Copying ${file.path} (${index + 1} of ${filesToCopy.length})...`,
      current: index + 1,
      total: filesToCopy.length,
      path: file.path
    });

    const failure = await copyDuplicateFile(sourceNodeUrl, newNodeUrl, file.path);
    if (!failure) {
      copied.push(file.path);
      continue;
    }

    failed.push(failure);
    if (file.path === 'script.py') {
      const status = failure.status ? `, HTTP ${failure.status}` : '';
      throw new NodelDuplicateNodeError(
        `Node "${newNodeName}" was created but is incomplete: failed to ${failure.phase} script.py (${failure.phase}${status}): ${failure.message}`,
        newNodeUrl,
        failed
      );
    }
  }

  reportDuplicateProgress(options, {
    phase: 'complete',
    message: failed.length > 0 ? `Copy completed with ${failed.length} failed file${failed.length === 1 ? '' : 's'}.` : 'Node copy complete.',
    current: filesToCopy.length,
    total: filesToCopy.length
  });

  return {
    url: newNodeUrl,
    copied,
    skipped,
    failed
  };
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
