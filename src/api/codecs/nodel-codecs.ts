import type {
  NodelActionDefinition,
  NodelActivityLogEntry,
  NodelActivityWebSocketMessage,
  NodelBuildInfo,
  NodelConsoleLogEntry,
  NodelDiagnosticMeasurement,
  NodelDiagnosticsResponse,
  NodelFileEntry,
  NodelHostLogEntry,
  NodelJsonSchema,
  NodelLocalNodeEntry,
  NodelLocalRestResponse,
  NodelNodeRestResponse,
  NodelNodeUrlEntry,
  NodelRecipeEntry,
  NodelRemoteBindings,
  NodelRestartStatus,
  NodelSignalDefinition,
  NodelToolkitResponse
} from '../nodel-types';
import { canonicalJavaAbsoluteHttpHref, canonicalRemoteNodeHref, hostMatchesRemoteNodeUrl, safeNavigationHref } from '../../utils/urls';
import {
  nodeFilePathCompatibility,
  nodeRecipePathCompatibility,
  registerDecodedNodeFileEntry,
  registerDecodedNodeRecipeEntry
} from '../../utils/node-file-path';
import { MAX_JSON_COLLECTION_ITEMS, MAX_JSON_DEPTH, validateJsonValueBounds } from '../../utils/json-value';
import { reduceNodeNameForPath } from '../../utils/node-name';

export const MAX_API_COLLECTION_ITEMS = MAX_JSON_COLLECTION_ITEMS;
export const MAX_DIAGNOSTIC_MEASUREMENTS = 1000;
export const MAX_DIAGNOSTIC_MEASUREMENT_SAMPLES = 5000;
export const MAX_DIAGNOSTIC_MEASUREMENT_TOTAL_SAMPLES = 50_000;
export const MAX_DIAGNOSTIC_MEASUREMENT_NAME_BYTES = 512;
const MAX_SCHEMA_DEPTH = 32;
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const unsafeActivityTimestampText = /[\u0000-\u001f\u007f]/;
const unsafePathText = /[\u0000-\u001f\u007f]/;
const schemaTypes = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

export class NodelApiDecodeError extends Error {
  constructor(context: string, path: string, expected: string) {
    const boundedPath = path.length > 180 ? `${path.slice(0, 100)}...${path.slice(-60)}` : path;
    super(`${context} returned invalid data at ${boundedPath}: ${expected}`.slice(0, 500));
    this.name = 'NodelApiDecodeError';
  }
}

function invalid(context: string, path: string, expected: string): never {
  throw new NodelApiDecodeError(context, path, expected);
}

function asRecord(value: unknown, context: string, path = '$') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(context, path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, context: string, path = '$') {
  if (!Array.isArray(value)) {
    invalid(context, path, 'expected an array');
  }
  if (value.length > MAX_API_COLLECTION_ITEMS) {
    invalid(context, path, `expected at most ${MAX_API_COLLECTION_ITEMS} items`);
  }
  return value as unknown[];
}

function limitedEntries(value: Record<string, unknown>, context: string, path: string) {
  const entries = Object.entries(value);
  if (entries.length > MAX_API_COLLECTION_ITEMS) {
    invalid(context, path, `expected at most ${MAX_API_COLLECTION_ITEMS} properties`);
  }
  return entries;
}

function requiredString(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim() || unsafeText.test(value)) {
    invalid(context, `${path}.${key}`, 'expected a non-empty string without control characters');
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || unsafeText.test(value)) {
    invalid(context, `${path}.${key}`, 'expected a string');
  }
  return value;
}

/** Display text is rendered as text or sanitized markdown, never used as an identifier. */
function optionalDisplayString(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    invalid(context, `${path}.${key}`, 'expected a string');
  }
  return value;
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(context, `${path}.${key}`, 'expected a finite number');
  }
  return value;
}

function requiredSequence(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(context, `${path}.${key}`, 'expected a non-negative safe integer');
  }
  return value;
}

function optionalSequence(record: Record<string, unknown>, key: string, context: string, path: string) {
  if (record[key] === undefined) {
    return undefined;
  }
  return requiredSequence(record, key, context, path);
}

function requiredTimestamp(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = requiredString(record, key, context, path);
  if (!Number.isFinite(Date.parse(value))) {
    invalid(context, `${path}.${key}`, 'expected a valid timestamp');
  }
  return value;
}

function optionalActivityTimestamp(record: Record<string, unknown>, key: string, context: string, path: string) {
  if (record[key] === undefined || record[key] === null) {
    return undefined;
  }

  const value = requiredString(record, key, context, path);
  if (unsafeActivityTimestampText.test(value)) {
    invalid(context, `${path}.${key}`, 'expected a valid timestamp');
  }
  if (!Number.isFinite(Date.parse(value))) {
    invalid(context, `${path}.${key}`, 'expected a valid timestamp');
  }
  return value;
}

function optionalTimestamp(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = optionalString(record, key, context, path);
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    invalid(context, `${path}.${key}`, 'expected a valid timestamp');
  }
  return value;
}

function validateJsonBounds(value: unknown, context: string, path: string): void {
  const failure = validateJsonValueBounds(value);
  if (!failure) return;
  const issuePath = failure.path === '$' ? path : `${path}${failure.path.slice(1)}`;
  const messages: Record<typeof failure.issue, string> = {
    depth: `value exceeds ${MAX_JSON_DEPTH} levels`,
    value: 'expected a JSON value',
    number: 'expected a finite JSON number',
    cyclic: 'expected an acyclic JSON value',
    prototype: 'expected a plain JSON object or array',
    'array-items': `expected at most ${MAX_API_COLLECTION_ITEMS} items`,
    'object-properties': `expected at most ${MAX_API_COLLECTION_ITEMS} properties`,
    'total-items': `expected at most ${MAX_API_COLLECTION_ITEMS} total items`
  };
  invalid(context, issuePath, messages[failure.issue]);
}

function requireSafeName(value: string, context: string, path: string) {
  if (!reduceNodeNameForPath(value) || value.length > 1000 || unsafePathText.test(value)) {
    invalid(context, path, 'expected a non-empty name without control characters');
  }
  return value;
}

function requiredPointName(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = record[key];
  if (typeof value !== 'string') {
    invalid(context, `${path}.${key}`, 'expected a point name');
  }
  return requireSafeName(value, context, `${path}.${key}`);
}

function normalizeOptionalStrings(record: Record<string, unknown>, keys: string[], context: string, path: string) {
  const result = { ...record };
  for (const key of keys) {
    const value = optionalString(record, key, context, path);
    if (value === undefined) {
      delete result[key];
    }
  }
  return result;
}

function normalizeOptionalDisplayStrings(record: Record<string, unknown>, keys: string[], context: string, path: string) {
  const result = { ...record };
  for (const key of keys) {
    const value = optionalDisplayString(record, key, context, path);
    if (value === undefined) {
      delete result[key];
    }
  }
  return result;
}

function normalizeOptionalDisplayStringsInto(result: Record<string, unknown>, record: Record<string, unknown>, keys: string[], context: string, path: string) {
  for (const key of keys) {
    const value = optionalDisplayString(record, key, context, path);
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

function optionalSchemaHint(record: Record<string, unknown>, context: string, path: string) {
  const value = record.hint;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
    return String(value);
  }
  invalid(context, `${path}.hint`, 'expected a string or finite scalar hint');
}

function normalizeOptionalSchemaText(record: Record<string, unknown>, context: string, path: string) {
  const result = normalizeOptionalStrings(record, ['format'], context, path);
  normalizeOptionalDisplayStringsInto(result, record, ['title', 'desc', 'group', 'caution'], context, path);
  const hint = optionalSchemaHint(record, context, path);
  if (hint === undefined) {
    delete result.hint;
  } else {
    result.hint = hint;
  }
  return result;
}

function decodeSchemaAt(value: unknown, context: string, path: string, depth: number): NodelJsonSchema {
  if (depth > MAX_SCHEMA_DEPTH) {
    invalid(context, path, `schema exceeds ${MAX_SCHEMA_DEPTH} levels`);
  }
  const record = asRecord(value, context, path);
  const result = normalizeOptionalSchemaText(record, context, path);
  const type = record.type;
  if (typeof type === 'string' && !schemaTypes.has(type)) {
    invalid(context, `${path}.type`, 'expected a supported JSON schema type');
  } else if (type === null) {
    result.type = null;
  } else if (type !== undefined && typeof type !== 'string') {
    const variants = asArray(type, context, `${path}.type`);
    if (variants.length === 0) {
      invalid(context, `${path}.type`, 'expected at least one schema variant');
    }
    result.type = variants.map((variant, index) => decodeSchemaAt(variant, context, `${path}.type[${index}]`, depth + 1));
  }
  if (record.enum !== undefined) {
    const enumValues = [...asArray(record.enum, context, `${path}.enum`)];
    if (enumValues.length === 0) {
      invalid(context, `${path}.enum`, 'expected at least one scalar value');
    }
    enumValues.forEach((item, index) => {
      validateJsonBounds(item, context, `${path}.enum[${index}]`);
      if (item !== null && typeof item !== 'string' && typeof item !== 'boolean' && (typeof item !== 'number' || !Number.isFinite(item))) {
        invalid(context, `${path}.enum[${index}]`, 'expected a JSON scalar value');
      }
    });
    result.enum = enumValues;
  }
  if (record.properties !== undefined) {
    const properties = asRecord(record.properties, context, `${path}.properties`);
    result.properties = Object.fromEntries(limitedEntries(properties, context, `${path}.properties`).map(([name, schema]) => [
      name,
      decodeSchemaAt(schema, context, `${path}.properties.${name}`, depth + 1)
    ]));
  }
  if (record.items !== undefined) {
    result.items = decodeSchemaAt(record.items, context, `${path}.items`, depth + 1);
  }
  for (const key of ['order', 'min', 'max', 'minItems', 'maxItems'] as const) {
    if (record[key] === null) {
      invalid(context, `${path}.${key}`, 'expected a finite number');
    }
    const number = optionalFiniteNumber(record, key, context, path);
    if (number !== undefined) {
      if ((key === 'minItems' || key === 'maxItems') && (!Number.isSafeInteger(number) || number < 0)) {
        invalid(context, `${path}.${key}`, 'expected a non-negative safe integer');
      }
      result[key] = number;
    }
  }
  if (record.step !== undefined) {
    if (record.step === null || (typeof record.step !== 'string' && (typeof record.step !== 'number' || !Number.isFinite(record.step)))) {
      invalid(context, `${path}.step`, 'expected a positive finite number or "any"');
    }
    if (record.step !== 'any' && ((typeof record.step === 'string' && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(record.step) || !Number.isFinite(Number(record.step)) || Number(record.step) <= 0)) || (typeof record.step === 'number' && record.step <= 0))) {
      invalid(context, `${path}.step`, 'expected a positive finite number or "any"');
    }
  }
  if (record.required !== undefined && typeof record.required !== 'boolean') {
    invalid(context, `${path}.required`, 'expected a boolean');
  }
  if (record.advanced !== undefined && typeof record.advanced !== 'boolean') {
    invalid(context, `${path}.advanced`, 'expected a boolean');
  }
  if (typeof result.min === 'number' && typeof result.max === 'number' && result.min > result.max) {
    invalid(context, path, 'minimum cannot exceed maximum');
  }
  if (typeof result.minItems === 'number' && typeof result.maxItems === 'number' && result.minItems > result.maxItems) {
    invalid(context, path, 'minItems cannot exceed maxItems');
  }
  return result;
}

export function decodeSchema(value: unknown, context: string): NodelJsonSchema {
  return decodeSchemaAt(value, context, '$', 0);
}

export function decodeLocalRest(value: unknown, context: string): NodelLocalRestResponse {
  const record = asRecord(value, context);
  if (record.nodes === undefined || record.nodes === null) {
    return record;
  }
  const nodes = asRecord(record.nodes, context, '$.nodes');
  const decoded = Object.fromEntries(limitedEntries(nodes, context, '$.nodes').map(([key, item]) => {
    const node = asRecord(item, context, `$.nodes.${key}`);
    const result = normalizeOptionalStrings(node, ['name', 'node', 'address'], context, `$.nodes.${key}`);
    normalizeOptionalDisplayStringsInto(result, node, ['desc'], context, `$.nodes.${key}`);
    const name = optionalString(node, 'name', context, `$.nodes.${key}`) ?? optionalString(node, 'node', context, `$.nodes.${key}`) ?? key;
    requireSafeName(name, context, `$.nodes.${key}.name`);
    result.name = name;
    const address = optionalString(node, 'address', context, `$.nodes.${key}`);
    if (address && !safeNavigationHref(address)) {
      invalid(context, `$.nodes.${key}.address`, 'expected a safe HTTP(S) URL');
    }
    return [key, result as NodelLocalNodeEntry];
  }));
  return { ...record, nodes: decoded };
}

export function decodeNodeDetails(value: unknown, context: string): NodelNodeRestResponse {
  const record = asRecord(value, context);
  const result = normalizeOptionalStrings(record, ['name'], context, '$');
  normalizeOptionalDisplayStringsInto(result, record, ['desc'], context, '$');
  return result;
}

export function decodeDiagnostics(value: unknown, context: string): NodelDiagnosticsResponse {
  const record = asRecord(value, context);
  const result = normalizeOptionalStrings(record, ['hostname', 'startTime', 'hostPath', 'nodesRoot', 'hostingRule', 'agent'], context, '$');
  for (const key of ['uptime', 'availableProcessors', 'freeMemory', 'maxMemory', 'totalMemory']) {
    optionalFiniteNumber(record, key, context, '$');
  }
  optionalTimestamp(record, 'startTime', context, '$');
  if (record.httpAddresses !== undefined && record.httpAddresses !== null) {
    result.httpAddresses = asArray(record.httpAddresses, context, '$.httpAddresses').map((item, index) => {
      const href = typeof item === 'string' ? canonicalJavaAbsoluteHttpHref(item) : null;
      if (!href) {
        invalid(context, `$.httpAddresses[${index}]`, 'expected an absolute HTTP(S) URL without credentials');
      }
      return href;
    });
  }
  if (record.vmArgs !== undefined && record.vmArgs !== null) {
    result.vmArgs = asArray(record.vmArgs, context, '$.vmArgs').map((item, index) => {
      if (typeof item !== 'string') {
        invalid(context, `$.vmArgs[${index}]`, 'expected a string');
      }
      return item;
    });
  }
  if (record.systemProperties !== undefined && record.systemProperties !== null) {
    const systemProperties = asRecord(record.systemProperties, context, '$.systemProperties');
    limitedEntries(systemProperties, context, '$.systemProperties');
    result.systemProperties = systemProperties;
  }
  return result;
}

export function decodeDiagnosticMeasurements(value: unknown, context: string): NodelDiagnosticMeasurement[] {
  const items = asArray(value, context);
  if (items.length > MAX_DIAGNOSTIC_MEASUREMENTS) {
    invalid(context, '$', `expected at most ${MAX_DIAGNOSTIC_MEASUREMENTS} measurements`);
  }
  const names = new Set<string>();
  let totalSamples = 0;
  return items.map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const name = requiredString(record, 'name', context, path);
    if (new TextEncoder().encode(name).byteLength > MAX_DIAGNOSTIC_MEASUREMENT_NAME_BYTES) {
      invalid(context, `${path}.name`, `expected at most ${MAX_DIAGNOSTIC_MEASUREMENT_NAME_BYTES} UTF-8 bytes`);
    }
    if (names.has(name)) {
      invalid(context, `${path}.name`, 'expected a unique measurement name');
    }
    names.add(name);
    if (typeof record.isRate !== 'boolean') {
      invalid(context, `${path}.isRate`, 'expected a boolean');
    }
    const rawValues = asArray(record.values, context, `${path}.values`);
    if (rawValues.length > MAX_DIAGNOSTIC_MEASUREMENT_SAMPLES) {
      invalid(context, `${path}.values`, `expected at most ${MAX_DIAGNOSTIC_MEASUREMENT_SAMPLES} samples`);
    }
    totalSamples += rawValues.length;
    if (totalSamples > MAX_DIAGNOSTIC_MEASUREMENT_TOTAL_SAMPLES) {
      invalid(context, '$', `expected at most ${MAX_DIAGNOSTIC_MEASUREMENT_TOTAL_SAMPLES} total samples`);
    }
    const values = rawValues.map((entry, valueIndex) => {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        invalid(context, `${path}.values[${valueIndex}]`, 'expected a finite number');
      }
      return entry;
    });
    optionalFiniteNumber(record, 'capacity', context, path);
    return { ...record, name, isRate: record.isRate, values };
  });
}

export function decodeBuildInfo(value: unknown, context: string): NodelBuildInfo {
  const record = asRecord(value, context);
  const result = normalizeOptionalStrings(record, ['project', 'version', 'date'], context, '$');
  normalizeOptionalDisplayStringsInto(result, record, ['origin', 'branch', 'id', 'rev', 'host'], context, '$');
  optionalTimestamp(record, 'date', context, '$');
  return result;
}

export function decodeHostLogs(value: unknown, context: string): NodelHostLogEntry[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const seq = requiredSequence(record, 'seq', context, path);
    const timestamp = requiredTimestamp(record, 'timestamp', context, path);
    for (const key of ['level', 'thread', 'tag']) {
      optionalString(record, key, context, path);
    }
    optionalDisplayString(record, 'message', context, path);
    if (record.error !== null) optionalDisplayString(record, 'error', context, path);
    const result = normalizeOptionalStrings(record, ['level', 'thread', 'tag'], context, path);
    normalizeOptionalDisplayStringsInto(result, record, ['message'], context, path);
    if (record.error === null) result.error = null;
    else normalizeOptionalDisplayStringsInto(result, record, ['error'], context, path);
    return { ...result, seq, timestamp };
  });
}

export function decodeToolkit(value: unknown, context: string): NodelToolkitResponse {
  const record = asRecord(value, context);
  return { ...record, script: requiredString(record, 'script', context, '$') };
}

export function decodeRestartStatus(value: unknown, context: string): NodelRestartStatus {
  const record = asRecord(value, context);
  if (record.timestamp !== undefined && record.timestamp !== null && (typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp)))) {
    invalid(context, '$.timestamp', 'expected a valid timestamp or null');
  }
  return { ...record, timestamp: record.timestamp ?? null };
}

export function decodeConsoleLogs(value: unknown, context: string): NodelConsoleLogEntry[] {
  const allowed = new Set(['out', 'err', 'warn', 'info']);
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const seq = requiredSequence(record, 'seq', context, path);
    const timestamp = requiredTimestamp(record, 'timestamp', context, path);
    const comment = optionalDisplayString(record, 'comment', context, path);
    if (comment === undefined) {
      invalid(context, `${path}.comment`, 'expected a string');
    }
    if (typeof record.console !== 'string' || !allowed.has(record.console)) {
      invalid(context, `${path}.console`, 'expected out, err, warn, or info');
    }
    return { ...record, seq, timestamp, comment, console: record.console } as NodelConsoleLogEntry;
  });
}

export function decodeActivityLogs(value: unknown, context: string): NodelActivityLogEntry[] {
  const sources = new Set(['local', 'remote', 'unbound']);
  const types = new Set(['action', 'event', 'actionBinding', 'eventBinding']);
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const seq = requiredSequence(record, 'seq', context, path);
    const timestamp = optionalActivityTimestamp(record, 'timestamp', context, path);
    const alias = requiredPointName(record, 'alias', context, path);
    if (typeof record.source !== 'string' || !sources.has(record.source)) {
      invalid(context, `${path}.source`, 'expected local, remote, or unbound');
    }
    if (typeof record.type !== 'string' || !types.has(record.type)) {
      invalid(context, `${path}.type`, 'expected a supported activity type');
    }
    if (record.arg !== undefined) {
      validateJsonBounds(record.arg, context, `${path}.arg`);
    }
    const result = { ...record } as Record<string, unknown>;
    if (timestamp === undefined) {
      delete result.timestamp;
    }
    return { ...result, seq, ...(timestamp !== undefined ? { timestamp } : {}), alias, source: record.source, type: record.type } as NodelActivityLogEntry;
  });
}

export function decodeActivityWebSocketMessage(value: unknown, context: string): NodelActivityWebSocketMessage {
  const record = asRecord(value, context);
  const result = normalizeOptionalStrings(record, ['node'], context, '$');
  normalizeOptionalDisplayStringsInto(result, record, ['error'], context, '$');
  if (record.activity !== undefined && record.activity !== null) {
    result.activity = decodeActivityLogs([record.activity], context)[0];
  }
  if (record.activityHistory !== undefined && record.activityHistory !== null) {
    result.activityHistory = decodeActivityLogs(record.activityHistory, context);
  }
  return result;
}

function decodeDefinitions<T extends NodelActionDefinition | NodelSignalDefinition>(value: unknown, context: string) {
  const record = asRecord(value, context);
  return Object.fromEntries(limitedEntries(record, context, '$').map(([key, item]) => {
    const path = `$.${key}`;
    const definition = asRecord(item, context, path);
    const name = requiredPointName(definition, 'name', context, path);
    const result = normalizeOptionalDisplayStrings(definition, ['title', 'desc', 'group', 'caution'], context, path);
    optionalFiniteNumber(definition, 'order', context, path);
    optionalSequence(definition, 'seq', context, path);
    optionalTimestamp(definition, 'timestamp', context, path);
    if (definition.schema !== undefined && definition.schema !== null) {
      result.schema = decodeSchemaAt(definition.schema, context, `${path}.schema`, 0);
    }
    if (definition.arg !== undefined) {
      validateJsonBounds(definition.arg, context, `${path}.arg`);
    }
    return [key, { ...result, name } as T];
  })) as Record<string, T>;
}

export function decodeActions(value: unknown, context: string) {
  return decodeDefinitions<NodelActionDefinition>(value, context);
}

export function decodeSignals(value: unknown, context: string) {
  return decodeDefinitions<NodelSignalDefinition>(value, context);
}

export function decodeRecord(value: unknown, context: string) {
  const record = asRecord(value, context);
  validateJsonBounds(record, context, '$');
  return record;
}

export function decodeRemoteBindings(value: unknown, context: string): NodelRemoteBindings {
  const record = asRecord(value, context);
  validateJsonBounds(record, context, '$');
  const result = cloneJsonValue(record) as Record<string, unknown>;
  for (const sectionName of ['actions', 'events'] as const) {
    if (record[sectionName] === undefined || record[sectionName] === null) {
      continue;
    }
    const section = asRecord(record[sectionName], context, `$.${sectionName}`);
    result[sectionName] = Object.fromEntries(limitedEntries(section, context, `$.${sectionName}`).map(([name, item]) => {
      const binding = asRecord(item, context, `$.${sectionName}.${name}`);
      const normalized = normalizeOptionalStrings(binding, ['node', 'action', 'event'], context, `$.${sectionName}.${name}`);
      return [name, normalized];
    }));
  }
  return result;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneJsonValue(child)]));
  }
  return value;
}

export function decodeFiles(value: unknown, context: string): NodelFileEntry[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    if (typeof record.path !== 'string') {
      invalid(context, `${path}.path`, 'expected a node file path');
    }
    const filePath = record.path;
    const compatibility = nodeFilePathCompatibility(filePath);
    if (!compatibility) {
      invalid(context, `${path}.path`, 'expected a safe relative node file path without traversal or root forms');
    }
    const result = normalizeOptionalStrings(record, ['modified'], context, path);
    optionalTimestamp(record, 'modified', context, path);
    const size = optionalFiniteNumber(record, 'size', context, path);
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0)) {
      invalid(context, `${path}.size`, 'expected a non-negative safe integer');
    }
    return registerDecodedNodeFileEntry({ ...result, path: filePath, compatibility, ...(size !== undefined ? { size } : {}) });
  });
}

export function decodeNodeUrls(value: unknown, context: string): NodelNodeUrlEntry[] {
  const items = asArray(value, context);
  const decoded: NodelNodeUrlEntry[] = [];
  let firstError: NodelApiDecodeError | null = null;
  items.forEach((item, index) => {
    const path = `$[${index}]`;
    try {
      const record = asRecord(item, context, path);
      const address = requiredString(record, 'address', context, path);
      const href = canonicalRemoteNodeHref(address);
      if (!href) {
        invalid(context, `${path}.address`, 'expected an absolute HTTP(S) node URL without credentials, query, or fragment');
      }
      const result = normalizeOptionalStrings(record, ['name', 'node', 'host'], context, path);
      const name = optionalString(record, 'name', context, path) ?? optionalString(record, 'node', context, path);
      if (!name) {
        invalid(context, path, 'expected a node or name field');
      }
      requireSafeName(name, context, `${path}.name`);
      const host = optionalString(record, 'host', context, path);
      if (host && !hostMatchesRemoteNodeUrl(host, href)) {
        invalid(context, `${path}.host`, 'expected the host from the node address');
      }
      decoded.push({ ...result, address: href });
    } catch (error) {
      if (!(error instanceof NodelApiDecodeError)) {
        throw error;
      }
      firstError ??= error;
    }
  });
  if (items.length > 0 && decoded.length === 0 && firstError !== null) {
    const errorToThrow: Error = firstError;
    throw errorToThrow;
  }
  return decoded;
}

export function decodeRecipes(value: unknown, context: string): NodelRecipeEntry[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    if (typeof record.path !== 'string') {
      invalid(context, `${path}.path`, 'expected a relative recipe path');
    }
    const compatibility = nodeRecipePathCompatibility(record.path);
    if (!compatibility) {
      invalid(context, `${path}.path`, 'expected a relative recipe path without traversal or root forms');
    }
    optionalTimestamp(record, 'modified', context, path);
    const result = normalizeOptionalStrings(record, ['modified'], context, path);
    result.path = record.path;
    result.compatibility = compatibility;
    normalizeOptionalDisplayStringsInto(result, record, ['readme', 'changelog'], context, path);
    return registerDecodedNodeRecipeEntry(result as unknown as NodelRecipeEntry);
  });
}
