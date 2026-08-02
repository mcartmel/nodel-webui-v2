import { fetchWithConnectivity } from '../data/connectivity';
import { remoteNodeEndpoint, safeNavigationHref } from '../utils/urls';
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
  decodeRecipes,
  decodeRecord,
  decodeRemoteBindings,
  decodeRestartStatus,
  decodeSchema,
  decodeSignals,
  decodeToolkit
} from './codecs/nodel-codecs';
import { assertSafeNodeFilePath } from '../utils/node-file-path';
import { DEFAULT_REQUEST_TIMEOUT_MS, FILE_REQUEST_TIMEOUT_MS, runWithDeadline } from './request';
import { boundedLongPollTimeout, fetchJson, fetchOk, postJson, responseError } from './http-transport';
import { isRecord, hasOwn } from '../utils/records';
export { createNode, removeCurrentNode, renameCurrentNode, restartCurrentNode } from './node-lifecycle';
export { waitForNodeReady } from './node-readiness';
export { duplicateNode, NodelDuplicateNodeError } from './node-duplication';
export { checkHostReachable, getNodeUrlsForNode, searchNodeUrls } from './node-discovery';
import type {
  NodelActivityLogEntry,
  NodelActionDefinition,
  NodelConsoleLogEntry,
  NodelBuildInfo,
  NodelDiagnosticMeasurement,
  NodelDiagnosticsResponse,
  NodelFileEntry,
  NodelHostLogEntry,
  NodelLocalRestResponse,
  NodelNodeRestResponse,
  NodelRestartStatus,
  NodelRecipeEntry,
  NodelRemoteBinding,
  NodelRemoteBindings,
  NodelJsonSchema,
  NodelSignalDefinition,
  NodelToolkitResponse
} from './nodel-types';
import { MAX_NODE_TEXT_EDIT_BYTES, NodeFileTooLargeError } from '../utils/node-file-limits';

export interface NodelCustomUiEntry {
  href: string;
  path: string;
  title: string;
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
  if (!hasOwn(events, alias)) {
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
    .filter((file) => {
      if (!file.path.startsWith('content/') || excluded.has(file.path)) {
        return false;
      }
      const title = file.path.slice('content/'.length);
      return title.length > 0 && /\.(xml|html|htm)$/i.test(title);
    })
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

export async function listRecipes(init?: RequestInit): Promise<NodelRecipeEntry[]> {
  return decodeRecipes(await fetchJson('/REST/recipes/list', init), 'GET /REST/recipes/list');
}

function decodeNodeFileText(bytes: Uint8Array, path: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${path} is not valid UTF-8 text`);
  }
}
