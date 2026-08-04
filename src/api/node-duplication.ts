import { fetchWithConnectivity } from '../data/connectivity';
import { encodeUrlPathSegment, localNodeUrl, remoteNodeEndpoint, safeRemoteNodeUrl } from '../utils/urls';
import { decodeFiles } from './codecs/nodel-codecs';
import { nodeFileAliasKey, portableNodeFilePathKey } from '../utils/node-file-path';
import { FILE_REQUEST_TIMEOUT_MS, runWithDeadline } from './request';
import { formatFileSize, MAX_NODE_DUPLICATE_FILE_BYTES, MAX_NODE_DUPLICATE_TOTAL_BYTES, NodeFileTooLargeError } from '../utils/node-file-limits';
import { boundedErrorMessage } from '../utils/errors';
import { assertUsableNodeName } from '../utils/node-name';
import { fetchJson, responseError, throwIfAborted } from './http-transport';
import { createNode } from './node-lifecycle';
import { waitForNodeReady } from './node-readiness';
import type {
  NodelDuplicateFileFailure,
  NodelDuplicateSkippedFile,
  NodelDuplicateNodeOptions,
  NodelDuplicateNodeResult,
  NodelDuplicateProgress,
  NodelFileEntry
} from './nodel-types';

interface DuplicateFilePlan {
  filesToCopy: DuplicateFileCopy[];
  skipped: string[];
  skippedDetails: NodelDuplicateSkippedFile[];
}

interface DuplicateFileCopy {
  destinationPath: string;
  file: NodelFileEntry;
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

function isNodeConfigAlias(path: string) {
  return path.toUpperCase().toLowerCase() === 'nodeconfig.json';
}

function shouldCopyDuplicateFile(path: string) {
  const basename = duplicateFileBasename(path);
  return !basename.startsWith('_')
    && !/^script_backup_.*\.py$/i.test(basename);
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

async function copyDuplicateFile(sourceNodeUrl: string, destinationNodeUrl: string, sourcePath: string, destinationPath: string, maxBytes: number, signal?: AbortSignal): Promise<{ failure: NodelDuplicateFileFailure | null; bytes: number }> {
  throwIfAborted(signal);
  let contents: ArrayBuffer;
  try {
    const result = await runWithDeadline(async (signal) => {
      const response = await fetchWithConnectivity(remoteNodeEndpoint(sourceNodeUrl, `REST/files/contents?path=${encodeUrlPathSegment(sourcePath)}`), { signal });
      if (!response.ok) {
        return { failure: await duplicateFileFailure(sourcePath, 'read', response), contents: null };
      }
      return { failure: null, contents: await readBoundedBinary(response, sourcePath, maxBytes) };
    }, signal, FILE_REQUEST_TIMEOUT_MS);
    if (result.failure) {
      return { failure: result.failure, bytes: 0 };
    }
    contents = result.contents;
  } catch (error) {
    throwIfAborted(signal);
    return { failure: networkDuplicateFileFailure(sourcePath, 'read', error), bytes: 0 };
  }

  try {
    const failure = await runWithDeadline(async (signal) => {
      const script = destinationPath === 'script.py'
        ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contents)
        : null;
      const response = await fetchWithConnectivity(remoteNodeEndpoint(destinationNodeUrl, script === null
        ? `REST/files/save?path=${encodeUrlPathSegment(destinationPath)}`
        : 'REST/script/save'), {
        method: 'POST',
        headers: { 'Content-Type': script === null ? 'application/octet-stream' : 'application/json' },
        body: script === null ? contents : JSON.stringify({ script }),
        signal
      });
      return response.ok ? null : duplicateFileFailure(sourcePath, 'save', response);
    }, signal, FILE_REQUEST_TIMEOUT_MS);
    if (failure) {
      return { failure, bytes: contents.byteLength };
    }
  } catch (error) {
    throwIfAborted(signal);
    return { failure: networkDuplicateFileFailure(sourcePath, 'save', error), bytes: contents.byteLength };
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
  const skippedDetails: NodelDuplicateSkippedFile[] = [];
  const byKey = new Map<string, DuplicateFileCopy>();
  const nodeConfigAliases: NodelFileEntry[] = [];
  let knownTotal = 0;

  const addFile = (file: NodelFileEntry, destinationPath = file.path) => {
    const key = nodeFileAliasKey(destinationPath);
    if (!key) {
      skipped.push(file.path);
      skippedDetails.push({ path: file.path, reason: 'Invalid destination path cannot be copied safely.' });
      return;
    }
    const existing = byKey.get(key);
    if (existing) {
      if (existing.file.path === file.path) {
        skipped.push(file.path);
        return;
      }
      throw new Error(`Source node file list contains ambiguous duplicate paths: ${existing.file.path} and ${file.path}`);
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
    byKey.set(key, { destinationPath, file });
  };

  for (const file of files) {
    const aliasKey = nodeFileAliasKey(file.path);
    if (!aliasKey) {
      skipped.push(file.path);
      skippedDetails.push({ path: file.path, reason: 'Invalid source path cannot be copied safely.' });
      continue;
    }
    if (file.compatibility === 'legacy') {
      skipped.push(file.path);
      skippedDetails.push({ path: file.path, reason: 'Legacy path is read-only and cannot be copied safely.' });
      continue;
    }
    if (portableNodeFilePathKey(file.path) === 'script.py' && file.path !== 'script.py') {
      skipped.push(file.path);
      skippedDetails.push({ path: file.path, reason: 'Case-only script.py aliases cannot be copied safely.' });
      continue;
    }
    if (isNodeConfigAlias(file.path)) {
      if (includeNodeConfig) {
        nodeConfigAliases.push(file);
      } else {
        skipped.push(file.path);
      }
      continue;
    }
    if (!shouldCopyDuplicateFile(file.path)) {
      skipped.push(file.path);
      continue;
    }
    addFile(file);
  }

  if (nodeConfigAliases.length > 0) {
    const selected = nodeConfigAliases.find((file) => file.path === 'nodeConfig.json') ?? nodeConfigAliases[0];
    for (const file of nodeConfigAliases) {
      if (file !== selected) {
        skipped.push(file.path);
      }
    }
    // Always write the known configuration filename, never a case alias that
    // could resolve to configuration unexpectedly on another filesystem.
    addFile(selected, 'nodeConfig.json');
  }

  const filesToCopy = Array.from(byKey.values())
    .sort((left, right) => Number(left.destinationPath === 'script.py') - Number(right.destinationPath === 'script.py'));
  return { filesToCopy, skipped, skippedDetails };
}

export async function duplicateNode(sourceNodeUrl: string, newNodeName: string, options: NodelDuplicateNodeOptions = {}): Promise<NodelDuplicateNodeResult> {
  assertUsableNodeName(newNodeName);
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
  const { filesToCopy, skipped, skippedDetails } = planDuplicateFiles(files, includeNodeConfig, maxFileBytes, maxTotalBytes);

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
  for (const [index, copy] of filesToCopy.entries()) {
    const { file, destinationPath } = copy;
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
    const result = await copyDuplicateFile(safeSourceUrl.href, newNodeUrl, file.path, destinationPath, Math.min(maxFileBytes, remainingBytes), options.signal).catch((error) => {
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
    message: failed.length > 0 || skippedDetails.length > 0
      ? `Copy completed with ${failed.length} failed and ${skippedDetails.length} skipped file${failed.length + skippedDetails.length === 1 ? '' : 's'}.`
      : 'Node copy complete.',
    current: filesToCopy.length,
    total: filesToCopy.length
  });

  return {
    url: newNodeUrl,
    copied,
    skipped,
    skippedDetails,
    failed
  };
}
