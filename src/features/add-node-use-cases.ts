import { createNode, duplicateNode, NodelDuplicateNodeError, waitForNodeReady } from '../api/nodel-host-client';
import type { NodelDuplicateNodeOptions, NodelDuplicateNodeResult } from '../api/nodel-types';
import { localNodePath, localNodeUrl } from '../utils/urls';

export { NodelDuplicateNodeError };

interface CreateAddNodeOptions {
  name: string;
  base?: string;
  onWaiting?: (url: string) => void;
  signal?: AbortSignal;
}

interface DuplicateAddNodeOptions extends Pick<NodelDuplicateNodeOptions, 'includeNodeConfig' | 'onProgress' | 'signal'> {
  name: string;
  sourceAddress: string;
}

export async function createAddNodeFromTemplate(options: CreateAddNodeOptions) {
  await createNode(options.name, options.base || undefined, { signal: options.signal });
  const url = localNodePath(options.name);
  options.onWaiting?.(url);
  await waitForNodeReady(localNodeUrl(options.name), 30, 1000, { signal: options.signal });
  return { url };
}

export function duplicateAddNodeFromSource(options: DuplicateAddNodeOptions): Promise<NodelDuplicateNodeResult> {
  return duplicateNode(options.sourceAddress, options.name, {
    includeNodeConfig: options.includeNodeConfig,
    onProgress: options.onProgress,
    signal: options.signal
  });
}
