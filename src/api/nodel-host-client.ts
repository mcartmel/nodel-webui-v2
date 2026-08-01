import { getVerySimpleName } from '../utils/node-name';
import { fetchWithConnectivity } from '../data/connectivity';
import { remoteNodeEndpoint, safeHostRestUrl, safeNavigationHref, safeRemoteNodeUrl } from '../utils/urls';
import {
  decodeActions,
  decodeActivityLogs,
  decodeBuildInfo,
  decodeConsoleLogs,
  decodeDiagnosticMeasurements,
  decodeDiagnostics,
  decodeFiles,
  decodeHostLogs,
  decodeLocalRest,
  decodeNodeDetails,
  decodeNodeUrls,
  decodeRecipes,
  decodeRecord,
  decodeRemoteBindings,
  decodeRestartStatus,
  decodeSchema,
  decodeSignals,
  decodeToolkit
} from './codecs/nodel-codecs';
import { assertSafeNodeFilePath } from '../utils/node-file-path';
import { DEFAULT_REQUEST_TIMEOUT_MS, FILE_REQUEST_TIMEOUT_MS, fetchWithDeadline, runWithDeadline } from './request';
import type {
  NodelActivityLogEntry,
  NodelActionDefinition,
  NodelConsoleLogEntry,
  NodelBuildInfo,
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
  NodelRemoteBinding,
  NodelRemoteBindings,
  NodelJsonSchema,
  NodelSignalDefinition,
  NodelToolkitResponse
} from './nodel-types';
import { MAX_NODE_TEXT_EDIT_BYTES, NodeFileTooLargeError } from '../utils/node-file-limits';

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

async function fetchJson(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithDeadline(async (signal) => {
    const response = await fetchWithConnectivity(input, { ...init, signal });
    if (!response.ok) {
      throw await responseError(response);
    }
    return response.json() as Promise<unknown>;
  }, callerSignal, timeoutMs);
}

async function postJson(input: RequestInfo | URL, body: unknown, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  return fetchJson(input, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(body)
  }, timeoutMs);
}

async function fetchOk(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithDeadline(async (signal) => {
    const response = await fetchWithConnectivity(input, { ...init, signal });
    if (!response.ok) {
      throw await responseError(response);
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json() as Promise<unknown>;
    }

    return response.text();
  }, callerSignal, timeoutMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

async function wait(ms: number, signal?: AbortSignal | null) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function boundedLongPollTimeout(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.trunc(value), 120_000)
    : 0;
}

export async function waitForNodeReady(nodeUrl: string, attempts = 30, intervalMs = 1000, init?: RequestInit): Promise<void> {
  const restUrl = remoteNodeEndpoint(nodeUrl, 'REST/');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithDeadline(restUrl, init, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.max(3000, intervalMs * 3)));
      if (response.ok) {
        return;
      }
    } catch (error) {
      if (init?.signal?.aborted) {
        throw error;
      }
      // keep retrying
    }

    await wait(intervalMs, init?.signal);
  }

  throw new Error('Timed out waiting for node to be ready');
}

export async function getLocalRest(init?: RequestInit): Promise<NodelLocalRestResponse> {
  return decodeLocalRest(await fetchJson('/REST', init), 'GET /REST');
}

export async function getDiagnostics(init?: RequestInit): Promise<NodelDiagnosticsResponse> {
  return decodeDiagnostics(await fetchJson('/REST/diagnostics', init), 'GET /REST/diagnostics');
}

export async function getDiagnosticMeasurements(init?: RequestInit): Promise<NodelDiagnosticMeasurement[]> {
  return decodeDiagnosticMeasurements(await fetchJson('/REST/diagnostics/measurements', init), 'GET /REST/diagnostics/measurements');
}

export async function getBuildInfo(init?: RequestInit): Promise<NodelBuildInfo> {
  return decodeBuildInfo(await fetchJson('/build.json', init), 'GET /build.json');
}

export async function getHostLogs(options: { from: number; max: number }, init?: RequestInit): Promise<NodelHostLogEntry[]> {
  return decodeHostLogs(await fetchJson(`/REST/logs?from=${options.from}&max=${options.max}`, init), 'GET /REST/logs');
}

export async function getToolkit(init?: RequestInit): Promise<NodelToolkitResponse> {
  return decodeToolkit(await fetchJson('/REST/toolkit', init), 'GET /REST/toolkit');
}

export async function getNodeDetails(init?: RequestInit): Promise<NodelNodeRestResponse> {
  return decodeNodeDetails(await fetchJson('REST/', init), 'GET REST/');
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
  const timeout = boundedLongPollTimeout(options.timeout);
  if (options.timestamp) {
    params.set('timestamp', options.timestamp);
  }
  if (timeout > 0) {
    params.set('timeout', String(timeout));
  }

  const query = params.toString();
  return decodeRestartStatus(
    await fetchJson(`REST/hasRestarted${query ? `?${query}` : ''}`, init, Math.max(DEFAULT_REQUEST_TIMEOUT_MS, timeout + 5000)),
    'GET REST/hasRestarted'
  );
}

export async function getNodeConsoleLogs(options: { from: number; max: number; timeout?: number }, init?: RequestInit): Promise<NodelConsoleLogEntry[]> {
  const timeout = boundedLongPollTimeout(options.timeout);
  return decodeConsoleLogs(
    await fetchJson(`REST/console?from=${options.from}&max=${options.max}${timeout > 0 ? `&timeout=${timeout}` : ''}`, init, Math.max(DEFAULT_REQUEST_TIMEOUT_MS, timeout + 5000)),
    'GET REST/console'
  );
}

export async function executeNodeConsoleCommand(code: string, init?: RequestInit): Promise<unknown> {
  return postJson('REST/exec', { code }, init);
}

export async function getNodeActivity(options: { from: number }, init?: RequestInit): Promise<NodelActivityLogEntry[]> {
  return decodeActivityLogs(await fetchJson(`REST/activity?from=${options.from}`, init), 'GET REST/activity');
}

export async function getNodeActions(init?: RequestInit): Promise<Record<string, NodelActionDefinition>> {
  return decodeActions(await fetchJson('REST/actions', init), 'GET REST/actions');
}

export async function getNodeSignals(init?: RequestInit): Promise<Record<string, NodelSignalDefinition>> {
  return decodeSignals(await fetchJson('REST/events', init), 'GET REST/events');
}

export async function callNodeAction(name: string, payload: unknown, init?: RequestInit): Promise<unknown> {
  return postJson(`REST/actions/${encodeURIComponent(name)}/call`, payload, init);
}

export async function emitNodeSignal(name: string, payload: unknown, init?: RequestInit): Promise<unknown> {
  return postJson(`REST/events/${encodeURIComponent(name)}/emit`, payload, init);
}

export async function getNodeParamsSchema(init?: RequestInit): Promise<NodelJsonSchema> {
  return decodeSchema(await fetchJson('REST/params/schema', init), 'GET REST/params/schema');
}

export async function getNodeParams(init?: RequestInit): Promise<Record<string, unknown>> {
  return decodeRecord(await fetchJson('REST/params', init), 'GET REST/params');
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
  return decodeSchema(await fetchJson('REST/remote/schema', init), 'GET REST/remote/schema');
}

export async function getNodeRemoteBindings(init?: RequestInit): Promise<NodelRemoteBindings> {
  return decodeRemoteBindings(await fetchJson('REST/remote', init), 'GET REST/remote');
}

export async function getNodeEventBinding(alias: string, init?: RequestInit): Promise<NodelRemoteBinding | null> {
  const bindings = await getNodeRemoteBindings(init);
  const events = bindings.events;
  if (events === undefined || events === null) {
    return null;
  }
  if (!isRecord(events)) {
    throw new Error('Remote event bindings are malformed');
  }
  if (!Object.prototype.hasOwnProperty.call(events, alias)) {
    return null;
  }
  const value = events[alias];
  if (!isRecord(value) || (value.node !== undefined && typeof value.node !== 'string')) {
    throw new Error(`Event binding "${alias}" is malformed`);
  }
  return {
    ...value,
    node: typeof value.node === 'string' ? value.node : ''
  } as NodelRemoteBinding;
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

export async function getRemoteNodeActions(nodeUrl: string, init?: RequestInit): Promise<Record<string, NodelActionDefinition>> {
  return decodeActions(await fetchJson(remoteNodeEndpoint(nodeUrl, 'REST/actions'), init), 'GET remote REST/actions');
}

export async function getRemoteNodeSignals(nodeUrl: string, init?: RequestInit): Promise<Record<string, NodelSignalDefinition>> {
  return decodeSignals(await fetchJson(remoteNodeEndpoint(nodeUrl, 'REST/events'), init), 'GET remote REST/events');
}

export async function listNodeFiles(init?: RequestInit): Promise<NodelFileEntry[]> {
  return decodeFiles(await fetchJson('REST/files', init), 'GET REST/files');
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
      const href = safeNavigationHref(title);
      if (!href) {
        return null;
      }
      return {
        href,
        path: file.path,
        title
      };
    })
    .filter((entry): entry is NodelCustomUiEntry => entry !== null);
}

export async function listCustomUiEntries(init?: RequestInit): Promise<NodelCustomUiEntry[]> {
  return customUiEntriesFromFiles(await listNodeFiles(init));
}

async function readBoundedText(response: Response, path: string, maxBytes: number) {
  const contentLengthHeader = response.headers.get('Content-Length');
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new NodeFileTooLargeError(path, maxBytes);
  }

  if (!response.body) {
    if (contentLength === undefined || !Number.isFinite(contentLength)) {
      throw new Error(`Cannot safely read ${path} without streaming or Content-Length`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new NodeFileTooLargeError(path, maxBytes);
    }
    return decodeNodeFileText(bytes, path);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new NodeFileTooLargeError(path, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeNodeFileText(bytes, path);
}

export async function getNodeFileContents(path: string, init?: RequestInit, maxBytes = MAX_NODE_TEXT_EDIT_BYTES): Promise<string> {
  assertSafeNodeFilePath(path);
  return runWithDeadline(async (signal) => {
    const response = await fetchWithConnectivity(`REST/files/contents?path=${encodeURIComponent(path)}`, { ...init, signal });
    if (!response.ok) {
      throw await responseError(response);
    }
    return readBoundedText(response, path, maxBytes);
  }, init?.signal, FILE_REQUEST_TIMEOUT_MS);
}

export async function saveNodeFile(path: string, content: BodyInit, init?: RequestInit): Promise<unknown> {
  assertSafeNodeFilePath(path);
  if (path === 'script.py') {
    return postJson('REST/script/save', { script: String(content) }, init, FILE_REQUEST_TIMEOUT_MS);
  }

  return fetchOk(`REST/files/save?path=${encodeURIComponent(path)}`, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(init?.headers ?? {})
    },
    body: content
  }, FILE_REQUEST_TIMEOUT_MS);
}

export async function deleteNodeFile(path: string, init?: RequestInit): Promise<unknown> {
  assertSafeNodeFilePath(path);
  return fetchOk(`REST/files/delete?path=${encodeURIComponent(path)}`, init, FILE_REQUEST_TIMEOUT_MS);
}

export async function searchNodeUrls(filter: string, init?: RequestInit): Promise<NodelNodeUrlEntry[]> {
  return decodeNodeUrls(await postJson('/REST/nodeURLs', { filter }, init), 'POST /REST/nodeURLs');
}

export async function getNodeUrlsForNode(name: string, init?: RequestInit): Promise<NodelNodeUrlEntry[]> {
  return decodeNodeUrls(await postJson('/REST/nodeURLsForNode', { name }, init), 'POST /REST/nodeURLsForNode');
}

export async function listRecipes(): Promise<NodelRecipeEntry[]> {
  return decodeRecipes(await fetchJson('/REST/recipes/list'), 'GET /REST/recipes/list');
}

export async function createNode(value: string, base?: string, init?: RequestInit): Promise<unknown> {
  const payload: Record<string, string> = { value };
  if (base) {
    payload.base = base;
  }

  return postJson('/REST/newNode', payload, init);
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

async function copyDuplicateFile(sourceNodeUrl: string, destinationNodeUrl: string, path: string, signal?: AbortSignal): Promise<NodelDuplicateFileFailure | null> {
  throwIfAborted(signal);
  let contents: ArrayBuffer;
  try {
    const result = await runWithDeadline(async (signal) => {
      const response = await fetchWithConnectivity(remoteNodeEndpoint(sourceNodeUrl, `REST/files/contents?path=${encodeURIComponent(path)}`), { signal });
      if (!response.ok) {
        return { failure: await duplicateFileFailure(path, 'read', response), contents: null };
      }
      return { failure: null, contents: await response.arrayBuffer() };
    }, signal, FILE_REQUEST_TIMEOUT_MS);
    if (result.failure) {
      return result.failure;
    }
    contents = result.contents;
  } catch (error) {
    throwIfAborted(signal);
    return networkDuplicateFileFailure(path, 'read', error);
  }

  try {
    const failure = await runWithDeadline(async (signal) => {
      const response = await fetchWithConnectivity(remoteNodeEndpoint(destinationNodeUrl, `REST/files/save?path=${encodeURIComponent(path)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: contents,
        signal
      });
      return response.ok ? null : duplicateFileFailure(path, 'save', response);
    }, signal, FILE_REQUEST_TIMEOUT_MS);
    if (failure) {
      return failure;
    }
  } catch (error) {
    throwIfAborted(signal);
    return networkDuplicateFileFailure(path, 'save', error);
  }

  return null;
}

export async function duplicateNode(sourceNodeUrl: string, newNodeName: string, options: NodelDuplicateNodeOptions = {}): Promise<NodelDuplicateNodeResult> {
  throwIfAborted(options.signal);
  const safeSourceUrl = safeRemoteNodeUrl(sourceNodeUrl);
  if (!safeSourceUrl) {
    throw new Error('Failed to read source node file list: remote node URL is invalid');
  }
  let files: NodelFileEntry[];
  try {
    const fileList = await fetchJson(remoteNodeEndpoint(safeSourceUrl.href, 'REST/files'), { signal: options.signal });
    files = decodeFiles(fileList, 'GET source REST/files');
  } catch (error) {
    throwIfAborted(options.signal);
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
    await createNode(newNodeName, undefined, { signal: options.signal });
  } catch (error) {
    throwIfAborted(options.signal);
    throw new Error(`Failed to create destination node "${newNodeName}": ${boundedErrorMessage(error, 'node creation failed')}`);
  }

  const newNodeUrl = new URL(`/nodes/${encodeURIComponent(getVerySimpleName(newNodeName))}/`, window.location.origin).href;
  reportDuplicateProgress(options, {
    phase: 'waiting',
    message: 'Waiting for the destination node to become available...',
    current: 0,
    total: filesToCopy.length
  });

  try {
    await waitForNodeReady(newNodeUrl, 30, 1000, { signal: options.signal });
  } catch (error) {
    throwIfAborted(options.signal);
    throw new NodelDuplicateNodeError(
      `Node "${newNodeName}" was created but may be incomplete because it did not become available: ${boundedErrorMessage(error, 'readiness check failed')}`,
      newNodeUrl
    );
  }

  const copied: string[] = [];
  const failed: NodelDuplicateFileFailure[] = [];
  for (const [index, file] of filesToCopy.entries()) {
    throwIfAborted(options.signal);
    reportDuplicateProgress(options, {
      phase: 'copying',
      message: `Copying ${file.path} (${index + 1} of ${filesToCopy.length})...`,
      current: index + 1,
      total: filesToCopy.length,
      path: file.path
    });

    const failure = await copyDuplicateFile(safeSourceUrl.href, newNodeUrl, file.path, options.signal);
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
  const restUrl = safeHostRestUrl(host);
  if (!restUrl) {
    return { host, reachable: false };
  }

  try {
    const response = await fetchWithDeadline(restUrl, { signal }, timeoutMs);
    return { host, reachable: response.ok || response.type === 'opaque' };
  } catch {
    return { host, reachable: false };
  }
}
function decodeNodeFileText(bytes: Uint8Array, path: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${path} is not valid UTF-8 text`);
  }
}
