import type { NodelActionDefinition, NodelSignalDefinition } from '../api/nodel-types';
import { codePoints, unicodeSearchKey } from '../utils/text-normalization';

export type SuggestionConfidence = '' | 'high' | 'medium' | 'ambiguous' | 'none';

export interface TargetDefinition {
  name: string;
  title: string;
  group: string;
}

export interface TargetOption {
  label: string;
  value: string;
  detail: string;
}

interface SuggestionSubject {
  alias: string;
  title: string;
}

function normalizeText(value: string) {
  return unicodeSearchKey(value);
}

function levenshtein(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  const left = codePoints(a);
  const right = codePoints(b);
  if (!a) {
    return right.length;
  }
  if (!b) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 0; i < left.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const cost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

export function bindingSimilarity(a: string, b: string) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    return 0.82;
  }
  const maxLength = Math.max(left.length, right.length);
  return 1 - levenshtein(left, right) / maxLength;
}

export function definitionsToOptions(definitions: TargetDefinition[], query: string): TargetOption[] {
  const normalized = normalizeText(query);
  return definitions
    .filter((definition) => {
      if (!normalized) {
        return true;
      }
      return normalizeText(definition.name).includes(normalized)
        || normalizeText(definition.title).includes(normalized)
        || normalizeText(definition.group).includes(normalized);
    })
    .slice(0, 20)
    .map((definition) => ({
      label: definition.title || definition.name,
      value: definition.name,
      detail: [definition.group ? `[${definition.group}]` : '', definition.name].filter(Boolean).join(' ')
    }));
}

export function normalizeDefinitions(definitions: Record<string, NodelActionDefinition | NodelSignalDefinition> | Array<NodelActionDefinition | NodelSignalDefinition>): TargetDefinition[] {
  const entries = Array.isArray(definitions)
    ? definitions.map((definition) => [definition.name, definition] as const)
    : Object.entries(definitions);

  return entries.map(([key, definition]) => {
    const name = definition.name || key;
    return {
      name,
      title: definition.title || name,
      group: definition.group || ''
    };
  });
}

export function mergeTargetDefinitions(definitions: TargetDefinition[]) {
  const byName = new Map<string, TargetDefinition>();
  for (const definition of definitions) {
    if (!byName.has(definition.name)) {
      byName.set(definition.name, definition);
    }
  }
  return Array.from(byName.values());
}

export function buildSuggestion(subject: SuggestionSubject, definitions: TargetDefinition[]) {
  const candidates = definitions
    .map((definition) => ({
      definition,
      score: Math.max(
        bindingSimilarity(subject.alias, definition.name),
        bindingSimilarity(subject.alias, definition.title),
        bindingSimilarity(subject.title, definition.name),
        bindingSimilarity(subject.title, definition.title)
      )
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.55) {
    return {
      value: '',
      label: 'No match',
      confidence: 'none' as SuggestionConfidence
    };
  }

  const tied = candidates.filter((candidate) => Math.abs(candidate.score - best.score) < 0.02);
  if (tied.length > 1) {
    return {
      value: '',
      label: `Ambiguous (${tied.length} matches)`,
      confidence: 'ambiguous' as SuggestionConfidence
    };
  }

  const confidence: SuggestionConfidence = best.score >= 0.8 ? 'high' : 'medium';
  return {
    value: best.definition.name,
    label: `${confidence}: ${best.definition.name}`,
    confidence
  };
}
