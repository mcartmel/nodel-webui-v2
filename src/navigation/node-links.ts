import { hasUnpairedSurrogate, safeNavigationUrl } from '../utils/urls';
import type { NodelNodeUrlEntry } from '../api/nodel-types';
import { isRecord } from '../utils/records';
import { isWellFormedUtf16 } from '../utils/node-name';
import { getNodeUrlsForNode } from '../api/nodel-host-client';

const MAX_CONCURRENT_NODE_RESOLUTIONS = 4;
const MAX_CACHED_NODE_RESOLUTIONS = 64;
const MAX_QUEUED_NODE_RESOLUTIONS = 128;

export function networkNodeSearchHref(node: string) {
  if (!node || hasUnpairedSurrogate(node)) {
    return '';
  }

  try {
    // Search queries preserve valid names exactly and never substitute UTF-16.
    return `/nodes.html?filter=${encodeURIComponent(node)}#Network`;
  } catch {
    return '';
  }
}

export function preferredNodeAddress(entries: unknown): URL | null {
  if (!Array.isArray(entries)) {
    return null;
  }
  const valid = entries
    .filter(isRecord)
    .map((entry) => entry as Partial<NodelNodeUrlEntry>)
    .map((entry) => typeof entry.address === 'string' ? safeNavigationUrl(entry.address) : null)
    .filter((url): url is URL => url !== null);
  return valid.find((url) => url.origin === window.location.origin) ?? valid[0] ?? null;
}

type PendingResolution = {
  name: string;
  controller: AbortController;
  consumers: Map<symbol, () => void>;
  promise: Promise<string | null>;
  complete: (address: string | null) => void;
  started: boolean;
};

export class NodeAddressResolver {
  private pending = new Map<string, PendingResolution>();
  private cache = new Map<string, string | null>();
  private queue: PendingResolution[] = [];
  private active = 0;
  private disposed = false;

  constructor(
    private readonly discover: typeof getNodeUrlsForNode = getNodeUrlsForNode,
    private readonly maxConcurrent = MAX_CONCURRENT_NODE_RESOLUTIONS,
    private readonly maxCached = MAX_CACHED_NODE_RESOLUTIONS
  ) {}

  resolve(name: string, options: { signal?: AbortSignal } = {}): Promise<string | null> {
    if (this.disposed || !name || !isWellFormedUtf16(name) || options.signal?.aborted) {
      return Promise.resolve(null);
    }
    const cached = this.cache.get(name);
    if (cached !== undefined || this.cache.has(name)) {
      this.cache.delete(name);
      this.cache.set(name, cached ?? null);
      return Promise.resolve(cached ?? null);
    }

    let request = this.pending.get(name);
    if (!request) {
      if (this.active >= this.maxConcurrent && this.queue.length >= MAX_QUEUED_NODE_RESOLUTIONS) {
        return Promise.resolve(null);
      }
      const controller = new AbortController();
      const consumers = new Map<symbol, () => void>();
      let complete!: (address: string | null) => void;
      const promise = new Promise<string | null>((resolve) => {
        complete = resolve;
      });
      request = { name, controller, consumers, promise, complete, started: false };
      this.pending.set(name, request);
      if (this.active < this.maxConcurrent) {
        this.start(name, request);
      } else {
        this.queue.push(request);
      }
    }

    const consumer = Symbol(name);
    return new Promise((resolve) => {
      let settled = false;
      const detach = () => {
        request.consumers.delete(consumer);
        options.signal?.removeEventListener('abort', abort);
        if (request.consumers.size === 0 && this.pending.get(name) === request) {
          request.controller.abort();
          this.pending.delete(name);
          if (!request.started) {
            this.queue = this.queue.filter((queued) => queued !== request);
            request.complete(null);
            this.drain();
          }
        }
      };
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        detach();
        resolve(value);
      };
      const abort = () => finish(null);
      request.consumers.set(consumer, abort);
      options.signal?.addEventListener('abort', abort, { once: true });
      void request.promise.then(finish);
      if (options.signal?.aborted) abort();
    });
  }

  clear() {
    this.cache.clear();
    const requests = Array.from(this.pending.values());
    this.pending.clear();
    this.queue = [];
    for (const request of requests) {
      for (const abort of request.consumers.values()) abort();
      request.controller.abort();
      if (!request.started) request.complete(null);
    }
  }

  dispose() {
    this.clear();
    this.disposed = true;
  }

  private remember(name: string, address: string) {
    this.cache.delete(name);
    this.cache.set(name, address);
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private start(name: string, request: PendingResolution) {
    request.started = true;
    this.active += 1;
    void Promise.resolve()
      .then(() => this.discover(name, { signal: request.controller.signal }))
      .then((entries) => preferredNodeAddress(entries)?.href ?? null)
      .catch(() => null)
      .then((address) => {
        if (!request.controller.signal.aborted && !this.disposed && this.pending.get(name) === request) {
          this.pending.delete(name);
          if (address) this.remember(name, address);
        }
        request.complete(address);
      })
      .finally(() => {
        this.active -= 1;
        this.drain();
      });
  }

  private drain() {
    while (!this.disposed && this.active < this.maxConcurrent && this.queue.length > 0) {
      const request = this.queue.shift();
      if (!request) return;
      if (this.pending.get(request.name) === request) this.start(request.name, request);
    }
  }
}
