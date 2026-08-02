import { remoteNodeEndpoint } from '../utils/urls';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithDeadline } from './request';
import { waitAbortable } from './http-transport';

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

    await waitAbortable(intervalMs, init?.signal);
  }

  throw new Error('Timed out waiting for node to be ready');
}
