import { searchNodeUrls } from '../api/nodel-host-client';
import type { NodelNodeUrlEntry } from '../api/nodel-types';
import { safeRemoteNodeUrl } from '../utils/urls';
import { getSimpleName } from '../utils/node-name';
import { buildSuggestion, definitionsToOptions, type SuggestionConfidence, type TargetOption } from './bindings-matching';
import type { BindingKind, BindingOption } from './bindings-model';
import { BindingTargetDiscoveryService } from './bindings-target-discovery';

const maxLookupResults = 20;

interface BindingTargetLookupRequest {
  kind: BindingKind;
  node: string;
  nodeAddress: string;
}

interface BindingSuggestionRequest extends BindingTargetLookupRequest {
  alias: string;
  title: string;
}

interface BindingSuggestion {
  value: string;
  label: string;
  confidence: SuggestionConfidence;
}

function nodeOption(entry: NodelNodeUrlEntry): BindingOption | null {
  const url = safeRemoteNodeUrl(entry.address);
  if (!url) {
    return null;
  }

  const label = getSimpleName(entry.node || entry.name || '') || getSimpleName(entry.address);
  return {
    label,
    value: label,
    address: url.href,
    detail: entry.host || url.host
  };
}

export class BindingLookupService {
  constructor(private readonly targetDiscovery = new BindingTargetDiscoveryService()) {}

  async searchNodeOptions(query: string, signal: AbortSignal): Promise<BindingOption[]> {
    if (!query.trim()) {
      return [];
    }

    const entries = await searchNodeUrls(query, { signal });
    return entries
      .map(nodeOption)
      .filter((option): option is BindingOption => option !== null)
      .slice(0, maxLookupResults);
  }

  async getTargetOptions(request: BindingTargetLookupRequest, query: string, signal: AbortSignal): Promise<TargetOption[]> {
    const definitions = await this.targetDiscovery.getDefinitions(request, signal);
    return definitionsToOptions(definitions, query);
  }

  async getSuggestion(request: BindingSuggestionRequest, signal: AbortSignal): Promise<BindingSuggestion> {
    const definitions = await this.targetDiscovery.getDefinitions(request, signal);
    return buildSuggestion(request, definitions);
  }

  clear() {
    this.targetDiscovery.clear();
  }
}
