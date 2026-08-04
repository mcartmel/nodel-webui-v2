import { getLocalRest, getRemoteNodeActions, getRemoteNodeSignals, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelLocalNodeEntry, NodelNodeUrlEntry } from '../api/nodel-types';
import { runWithDeadline } from '../api/request';
import { getSimpleName, getVerySimpleName, isUsableNodeName } from '../utils/node-name';
import { localNodeUrl, safeRemoteNodeUrl } from '../utils/urls';
import { unicodeSearchKey } from '../utils/text-normalization';
import { mergeTargetDefinitions, normalizeDefinitions, type TargetDefinition } from './bindings-matching';

type BindingTargetDiscoveryKind = 'actions' | 'events';

interface BindingTargetDiscoveryRequest {
  kind: BindingTargetDiscoveryKind;
  node: string;
  nodeAddress: string;
}

interface TargetCacheEntry {
  expiresAt: number;
  definitions: TargetDefinition[];
}

interface LocalNodeCandidate {
  name: string;
}

const targetCacheTtlMs = 30 * 1000;
const targetLookupTimeoutMs = 3000;
const maxLookupResults = 20;

function normalizeText(value: string) {
  return unicodeSearchKey(value);
}

function normalizeNodeIdentity(value: string) {
  return normalizeText(getVerySimpleName(getSimpleName(value)));
}

function nodeNameMatches(left: string, right: string) {
  const normalizedLeft = normalizeNodeIdentity(left);
  const normalizedRight = normalizeNodeIdentity(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function nodeUrlMatches(entry: NodelNodeUrlEntry, node: string) {
  return nodeNameMatches(entry.node || entry.name || getSimpleName(entry.address), node);
}

function localNodeName(key: string, entry: NodelLocalNodeEntry) {
  return entry.name || entry.node || key;
}

function nodeBaseUrl(nodeUrl: string) {
  return nodeUrl.replace(/\/?$/, '/');
}

function safeLocalNodeUrl(name: string) {
  return isUsableNodeName(name) ? localNodeUrl(name) : null;
}

function uniqueUrls(urls: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    let normalized = safeRemoteNodeUrl(url)?.href;
    if (!normalized) {
      try {
        normalized = safeRemoteNodeUrl(new URL(nodeBaseUrl(url), window.location.origin).href)?.href;
      } catch {
        continue;
      }
    }
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

export class BindingTargetDiscoveryService {
  private targetCache = new Map<string, TargetCacheEntry>();
  private cacheGeneration = 0;
  private localNodes: LocalNodeCandidate[] | null = null;
  private localNodesPromise: Promise<LocalNodeCandidate[]> | null = null;
  private localNodesController: AbortController | null = null;

  async getDefinitions(request: BindingTargetDiscoveryRequest, signal: AbortSignal): Promise<TargetDefinition[]> {
    const key = this.targetCacheKey(request);
    const cached = this.targetCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.definitions;
    }

    const generation = this.cacheGeneration;
    const definitions = await this.loadTargetDefinitions(request, signal);
    if (signal.aborted || generation !== this.cacheGeneration) {
      return definitions;
    }
    this.targetCache.set(key, {
      expiresAt: Date.now() + targetCacheTtlMs,
      definitions
    });
    return definitions;
  }

  clear() {
    this.cacheGeneration += 1;
    this.localNodesController?.abort();
    this.localNodesController = null;
    this.targetCache.clear();
    this.localNodes = null;
    this.localNodesPromise = null;
  }

  private targetCacheKey(request: BindingTargetDiscoveryRequest) {
    return `${request.kind}:${normalizeNodeIdentity(request.node)}:${request.nodeAddress}`;
  }

  private async loadTargetDefinitions(request: BindingTargetDiscoveryRequest, signal: AbortSignal) {
    const localNode = await this.findLocalNode(request.node, signal);
    if (signal.aborted) {
      return [];
    }
    if (localNode) {
      const nodeUrl = safeLocalNodeUrl(localNode.name);
      return nodeUrl ? this.fetchTargetDefinitions(request.kind, nodeUrl, signal) : [];
    }

    const entries = await searchNodeUrls(request.node, { signal });
    if (signal.aborted) {
      return [];
    }
    const matchingUrls = entries
      .filter((entry) => nodeUrlMatches(entry, request.node))
      .map((entry) => entry.address);
    const candidateUrls = uniqueUrls([
      request.nodeAddress,
      ...matchingUrls,
      matchingUrls.length === 0 && entries[0] ? entries[0].address : '',
      matchingUrls.length === 0 && entries.length === 0 ? safeLocalNodeUrl(request.node) ?? '' : ''
    ].filter((url): url is string => Boolean(url))).slice(0, maxLookupResults);
    if (candidateUrls.length === 0) {
      return [];
    }

    const results = await Promise.all(candidateUrls.map((url) => this.fetchTargetDefinitions(request.kind, url, signal).then(
      (definitions) => ({ definitions, ok: true as const }),
      (error) => {
        if (signal.aborted) {
          throw error;
        }
        return { definitions: [], ok: false as const };
      }
    )));
    if (signal.aborted) {
      return [];
    }
    if (!results.some((result) => result.ok)) {
      throw new Error('Failed to load target definitions');
    }
    return mergeTargetDefinitions(results.flatMap((result) => result.definitions));
  }

  private async fetchTargetDefinitions(kind: BindingTargetDiscoveryKind, nodeUrl: string, signal: AbortSignal): Promise<TargetDefinition[]> {
    const definitions = await runWithDeadline(
      (deadlineSignal) => (kind === 'actions' ? getRemoteNodeActions(nodeUrl, { signal: deadlineSignal }) : getRemoteNodeSignals(nodeUrl, { signal: deadlineSignal })),
      signal,
      targetLookupTimeoutMs
    );
    return normalizeDefinitions(definitions);
  }

  private async findLocalNode(node: string, signal: AbortSignal) {
    if (signal.aborted) {
      return undefined;
    }
    const localNodes = await this.getLocalNodes().catch(() => []);
    if (signal.aborted) {
      return undefined;
    }
    return localNodes.find((candidate) => nodeNameMatches(candidate.name, node));
  }

  private async getLocalNodes(): Promise<LocalNodeCandidate[]> {
    if (this.localNodes) {
      return this.localNodes;
    }
    if (!this.localNodesPromise) {
      const generation = this.cacheGeneration;
      const controller = new AbortController();
      this.localNodesController = controller;
      const request = getLocalRest({ signal: controller.signal }).then((rest) => Object.entries(rest.nodes ?? {}).map(([key, entry]) => ({
        name: localNodeName(key, entry)
      })));
      const promise = request.then((nodes) => {
        if (generation === this.cacheGeneration) {
          this.localNodes = nodes;
        }
        return nodes;
      }).catch((error) => {
        if (generation === this.cacheGeneration && this.localNodesController === controller) {
          this.localNodesPromise = null;
        }
        throw error;
      }).finally(() => {
        if (this.localNodesController === controller) {
          this.localNodesController = null;
        }
      });
      this.localNodesPromise = promise;
    }
    return this.localNodesPromise!;
  }
}
