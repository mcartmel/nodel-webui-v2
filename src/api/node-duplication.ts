import { fetchWithConnectivity } from '../data/connectivity';
import { localNodeUrl, remoteNodeEndpoint, safeRemoteNodeUrl } from '../utils/urls';
import { decodeFiles } from './codecs/nodel-codecs';
import { portableNodeFilePathKey } from '../utils/node-file-path';
import { FILE_REQUEST_TIMEOUT_MS, runWithDeadline } from './request';
import { formatFileSize, MAX_NODE_DUPLICATE_FILE_BYTES, MAX_NODE_DUPLICATE_TOTAL_BYTES, NodeFileTooLargeError } from '../utils/node-file-limits';
import { boundedErrorMessage } from '../utils/errors';
import { fetchJson, responseError, throwIfAborted } from './http-transport';
import { createNode } from './node-lifecycle';
import { waitForNodeReady } from './node-readiness';
import type {
  NodelDuplicateFileFailure,
  NodelDuplicateNodeOptions,
  NodelDuplicateNodeResult,
  NodelDuplicateProgress,
  NodelFileEntry
} from './nodel-types';

interface DuplicateFilePlan {
  filesToCopy: NodelFileEntry[];
  skipped: string[];
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

async function readBoundedBinary(response: Response, path: string, maxBytes: number) {
  const contentLengthHeader = response.headers.get('Content-Length');
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new NodeFileTooLargeError(path, maxBytes, 'duplicate-copy');
  }

  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new NodeFileTooLargeError(path, maxBytes, 'duplicate-copy');
    }
    return bytes;
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
        throw new NodeFileTooLargeError(path, maxBytes, 'duplicate-copy');
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
  return bytes.buffer;
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

async function copyDuplicateFile(sourceNodeUrl: string, destinationNodeUrl: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<{ failure: NodelDuplicateFileFailure | null; bytes: number }> {
  throwIfAborted(signal);
  let contents: ArrayBuffer;
  try {
    const result = await runWithDeadline(async (signal) => {
      const response = await fetchWithConnectivity(remoteNodeEndpoint(sourceNodeUrl, `REST/files/contents?path=${encodeURIComponent(path)}`), { signal });
      if (!response.ok) {
        return { failure: await duplicateFileFailure(path, 'read', response), contents: null };
      }
      return { failure: null, contents: await readBoundedBinary(response, path, maxBytes) };
    }, signal, FILE_REQUEST_TIMEOUT_MS);
    if (result.failure) {
      return { failure: result.failure, bytes: 0 };
    }
    contents = result.contents;
  } catch (error) {
    throwIfAborted(signal);
    return { failure: networkDuplicateFileFailure(path, 'read', error), bytes: 0 };
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
      return { failure, bytes: contents.byteLength };
    }
  } catch (error) {
    throwIfAborted(signal);
    return { failure: networkDuplicateFileFailure(path, 'save', error), bytes: contents.byteLength };
  }

  return { failure: null, bytes: contents.byteLength };
}

function duplicateCanceledError(newNodeName: string, destinationUrl: string, failed: NodelDuplicateFileFailure[] = []) {
  return new NodelDuplicateNodeError(
    `Node "${newNodeName}" copy was canceled after the destination was created. The node may be incomplete; no cleanup was attempted automatically.`,
    destinationUrl,
    failed
  );
}

function planDuplicateFiles(files: NodelFileEntry[], includeNodeConfig: boolean, maxFileBytes: number, maxTotalBytes: number): DuplicateFilePlan {
  const skipped: string[] = [];
  const byKey = new Map<string, NodelFileEntry>();
  let knownTotal = 0;

  for (const file of files) {
    if (!shouldCopyDuplicateFile(file.path, includeNodeConfig)) {
      skipped.push(file.path);
      continue;
    }
    const key = portableNodeFilePathKey(file.path);
    const existing = byKey.get(key);
    if (existing) {
      if (existing.path === file.path) {
        skipped.push(file.path);
        continue;
      }
      throw new Error(`Source node file list contains ambiguous duplicate paths: ${existing.path} and ${file.path}`);
    }
    if (typeof file.size === 'number') {
      if (file.size > maxFileBytes) {
        throw new Error(`${file.path} exceeds the ${formatFileSize(maxFileBytes)} duplicate-copy limit.`);
      }
      knownTotal += file.size;
      if (knownTotal > maxTotalBytes) {
        throw new Error(`Source files exceed the ${formatFileSize(maxTotalBytes)} duplicate-copy total limit.`);
      }
    }
    byKey.set(key, file);
  }

  const filesToCopy = Array.from(byKey.values())
    .sort((left, right) => Number(left.path === 'script.py') - Number(right.path === 'script.py'));
  return { filesToCopy, skipped };
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
  const maxFileBytes = options.maxFileBytes ?? MAX_NODE_DUPLICATE_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_NODE_DUPLICATE_TOTAL_BYTES;
  const { filesToCopy, skipped } = planDuplicateFiles(files, includeNodeConfig, maxFileBytes, maxTotalBytes);

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

  const newNodeUrl = localNodeUrl(newNodeName);
  reportDuplicateProgress(options, {
    phase: 'waiting',
    message: 'Waiting for the destination node to become available...',
    current: 0,
    total: filesToCopy.length
  });

  try {
    await waitForNodeReady(newNodeUrl, 30, 1000, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) {
      throw duplicateCanceledError(newNodeName, newNodeUrl);
    }
    throw new NodelDuplicateNodeError(
      `Node "${newNodeName}" was created but may be incomplete because it did not become available: ${boundedErrorMessage(error, 'readiness check failed')}`,
      newNodeUrl
    );
  }

  const copied: string[] = [];
  const failed: NodelDuplicateFileFailure[] = [];
  let copiedBytes = 0;
  for (const [index, file] of filesToCopy.entries()) {
    if (options.signal?.aborted) {
      throw duplicateCanceledError(newNodeName, newNodeUrl, failed);
    }
    reportDuplicateProgress(options, {
      phase: 'copying',
      message: `Copying ${file.path} (${index + 1} of ${filesToCopy.length})...`,
      current: index + 1,
      total: filesToCopy.length,
      path: file.path
    });

    const remainingBytes = Math.max(0, maxTotalBytes - copiedBytes);
    const result = await copyDuplicateFile(safeSourceUrl.href, newNodeUrl, file.path, Math.min(maxFileBytes, remainingBytes), options.signal).catch((error) => {
      if (options.signal?.aborted) {
        throw duplicateCanceledError(newNodeName, newNodeUrl, failed);
      }
      throw error;
    });
    copiedBytes += result.bytes;
    const failure = result.failure;
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
