import { safeHostRestUrl } from '../utils/urls';
import { isAbortError } from '../utils/errors';
import { decodeNodeUrls } from './codecs/nodel-codecs';
import { postJson } from './http-transport';
import { fetchWithDeadline } from './request';
import type { NodelNodeUrlEntry } from './nodel-types';

interface NodelReachabilityResult {
  host: string;
  reachable: boolean;
}

export async function searchNodeUrls(filter: string, init?: RequestInit): Promise<NodelNodeUrlEntry[]> {
  return decodeNodeUrls(await postJson('/REST/nodeURLs', { filter }, init), 'POST /REST/nodeURLs');
}

export async function getNodeUrlsForNode(name: string, init?: RequestInit): Promise<NodelNodeUrlEntry[]> {
  return decodeNodeUrls(await postJson('/REST/nodeURLsForNode', { name }, init), 'POST /REST/nodeURLsForNode');
}

export async function checkHostReachable(host: string, timeoutMs = 3000, signal?: AbortSignal): Promise<NodelReachabilityResult> {
  const restUrl = safeHostRestUrl(host);
  if (!restUrl) {
    return { host, reachable: false };
  }

  try {
    const response = await fetchWithDeadline(restUrl, {
      signal,
      mode: restUrl.origin === window.location.origin ? 'cors' : 'no-cors'
    }, timeoutMs);
    if (signal?.aborted) {
      throw new DOMException('The reachability probe was aborted', 'AbortError');
    }
    return { host, reachable: response.ok || response.type === 'opaque' };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw error;
    }
    return { host, reachable: false };
  }
}
