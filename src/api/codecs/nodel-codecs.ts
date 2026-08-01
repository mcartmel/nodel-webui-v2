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
import { safeAbsoluteHttpUrl, safeHostRestUrl, safeNavigationHref, safeRemoteNodeUrl } from '../../utils/urls';
import { isSafeNodeFilePath, MAX_NODE_FILE_PATH_LENGTH } from '../../utils/node-file-path';

export const MAX_API_COLLECTION_ITEMS = 10_000;
const MAX_SCHEMA_DEPTH = 32;
const MAX_JSON_DEPTH = 64;
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
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
  return value;
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

function optionalTimestamp(record: Record<string, unknown>, key: string, context: string, path: string) {
  const value = optionalString(record, key, context, path);
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    invalid(context, `${path}.${key}`, 'expected a valid timestamp');
  }
  return value;
}

function validateJsonBounds(value: unknown, context: string, path: string, depth = 0, seen = new WeakSet<object>()): void {
  if (depth > MAX_JSON_DEPTH) {
    invalid(context, path, `value exceeds ${MAX_JSON_DEPTH} levels`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      invalid(context, path, 'expected a finite JSON number');
    }
    return;
  }
  if (typeof value !== 'object') {
    invalid(context, path, 'expected a JSON value');
  }
  if (seen.has(value)) {
    invalid(context, path, 'expected an acyclic JSON value');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    asArray(value, context, path).forEach((item, index) => validateJsonBounds(item, context, `${path}[${index}]`, depth + 1, seen));
  } else {
    limitedEntries(value as Record<string, unknown>, context, path).forEach(([key, item]) => validateJsonBounds(item, context, `${path}.${key}`, depth + 1, seen));
  }
  seen.delete(value);
}

function requireSafeName(value: string, context: string, path: string) {
  if (!value.trim() || value.length > 1000 || unsafePathText.test(value)) {
    invalid(context, path, 'expected a non-empty name without control characters');
  }
  return value;
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

function decodeSchemaAt(value: unknown, context: string, path: string, depth: number): NodelJsonSchema {
  if (depth > MAX_SCHEMA_DEPTH) {
    invalid(context, path, `schema exceeds ${MAX_SCHEMA_DEPTH} levels`);
  }
  const record = asRecord(value, context, path);
  const result = normalizeOptionalStrings(record, ['title', 'desc', 'hint', 'format', 'group', 'caution'], context, path);
  const type = record.type;
  if (typeof type === 'string' && !schemaTypes.has(type)) {
    invalid(context, `${path}.type`, 'expected a supported JSON schema type');
  } else if (type !== undefined && type !== null && typeof type !== 'string') {
    const variants = asArray(type, context, `${path}.type`);
    if (variants.length === 0) {
      invalid(context, `${path}.type`, 'expected at least one schema variant');
    }
    result.type = variants.map((variant, index) => decodeSchemaAt(variant, context, `${path}.type[${index}]`, depth + 1));
  }
  if (record.enum !== undefined) {
    const enumValues = [...asArray(record.enum, context, `${path}.enum`)];
    enumValues.forEach((item, index) => validateJsonBounds(item, context, `${path}.enum[${index}]`));
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
    const number = optionalFiniteNumber(record, key, context, path);
    if (number !== undefined) {
      if ((key === 'minItems' || key === 'maxItems') && (!Number.isSafeInteger(number) || number < 0)) {
        invalid(context, `${path}.${key}`, 'expected a non-negative safe integer');
      }
      result[key] = number;
    }
  }
  if (record.step !== undefined && record.step !== null && typeof record.step !== 'string' && (typeof record.step !== 'number' || !Number.isFinite(record.step))) {
    invalid(context, `${path}.step`, 'expected a finite number or string');
  }
  if (record.required !== undefined && record.required !== null && typeof record.required !== 'boolean') {
    invalid(context, `${path}.required`, 'expected a boolean');
  }
  if (record.advanced !== undefined && record.advanced !== null && typeof record.advanced !== 'boolean') {
    invalid(context, `${path}.advanced`, 'expected a boolean');
  }
  return result as NodelJsonSchema;
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
    const result = normalizeOptionalStrings(node, ['name', 'node', 'address', 'desc'], context, `$.nodes.${key}`);
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
  return normalizeOptionalStrings(asRecord(value, context), ['name', 'desc'], context, '$');
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
      if (typeof item !== 'string' || !safeAbsoluteHttpUrl(item)) {
        invalid(context, `$.httpAddresses[${index}]`, 'expected an absolute HTTP(S) URL without credentials');
      }
      return item;
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
  return result as NodelDiagnosticsResponse;
}

export function decodeDiagnosticMeasurements(value: unknown, context: string): NodelDiagnosticMeasurement[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const name = requiredString(record, 'name', context, path);
    if (typeof record.isRate !== 'boolean') {
      invalid(context, `${path}.isRate`, 'expected a boolean');
    }
    const values = asArray(record.values, context, `${path}.values`).map((entry, valueIndex) => {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        invalid(context, `${path}.values[${valueIndex}]`, 'expected a finite number');
      }
      return entry;
    });
    optionalFiniteNumber(record, 'capacity', context, path);
    return { ...record, name, isRate: record.isRate, values } as NodelDiagnosticMeasurement;
  });
}

export function decodeBuildInfo(value: unknown, context: string): NodelBuildInfo {
  const record = asRecord(value, context);
  const result = normalizeOptionalStrings(record, ['project', 'origin', 'branch', 'version', 'id', 'rev', 'host', 'date'], context, '$');
  const origin = optionalString(record, 'origin', context, '$');
  if (origin && !safeAbsoluteHttpUrl(origin)) {
    invalid(context, '$.origin', 'expected an absolute HTTP(S) URL without credentials');
  }
  optionalTimestamp(record, 'date', context, '$');
  return result;
}

export function decodeHostLogs(value: unknown, context: string): NodelHostLogEntry[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const seq = requiredSequence(record, 'seq', context, path);
    const timestamp = requiredTimestamp(record, 'timestamp', context, path);
    for (const key of ['level', 'thread', 'tag', 'message', 'error']) {
      optionalString(record, key, context, path);
    }
    const result = { ...record };
    return { ...result, seq, timestamp } as NodelHostLogEntry;
  });
}

export function decodeToolkit(value: unknown, context: string): NodelToolkitResponse {
  const record = asRecord(value, context);
  return { ...record, script: requiredString(record, 'script', context, '$') };
}

export function decodeRestartStatus(value: unknown, context: string): NodelRestartStatus {
  const record = asRecord(value, context);
  if (record.timestamp !== null && (typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp)))) {
    invalid(context, '$.timestamp', 'expected a valid timestamp or null');
  }
  return record as unknown as NodelRestartStatus;
}

export function decodeConsoleLogs(value: unknown, context: string): NodelConsoleLogEntry[] {
  const allowed = new Set(['out', 'err', 'warn', 'info']);
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const seq = requiredSequence(record, 'seq', context, path);
    const timestamp = requiredTimestamp(record, 'timestamp', context, path);
    const comment = requiredString(record, 'comment', context, path);
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
    const timestamp = requiredTimestamp(record, 'timestamp', context, path);
    const alias = requiredString(record, 'alias', context, path);
    if (typeof record.source !== 'string' || !sources.has(record.source)) {
      invalid(context, `${path}.source`, 'expected local, remote, or unbound');
    }
    if (typeof record.type !== 'string' || !types.has(record.type)) {
      invalid(context, `${path}.type`, 'expected a supported activity type');
    }
    if (record.arg !== undefined) {
      validateJsonBounds(record.arg, context, `${path}.arg`);
    }
    return { ...record, seq, timestamp, alias, source: record.source, type: record.type } as NodelActivityLogEntry;
  });
}

export function decodeActivityWebSocketMessage(value: unknown, context: string): NodelActivityWebSocketMessage {
  const record = asRecord(value, context);
  const result = normalizeOptionalStrings(record, ['node', 'error'], context, '$');
  const backendError = optionalString(record, 'error', context, '$');
  if (backendError !== undefined) {
    result.error = backendError.replace(/\s+/g, ' ').trim().slice(0, 500);
  }
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
    const name = requiredString(definition, 'name', context, path);
    const result = normalizeOptionalStrings(definition, ['title', 'desc', 'group', 'caution'], context, path);
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
  const result = { ...record };
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

export function decodeFiles(value: unknown, context: string): NodelFileEntry[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    const filePath = requiredString(record, 'path', context, path);
    if (!isSafeNodeFilePath(filePath)) {
      invalid(context, `${path}.path`, 'expected a safe relative node file path');
    }
    const result = normalizeOptionalStrings(record, ['modified'], context, path);
    optionalTimestamp(record, 'modified', context, path);
    const size = optionalFiniteNumber(record, 'size', context, path);
    if (size !== undefined && size < 0) {
      invalid(context, `${path}.size`, 'expected a non-negative number');
    }
    return { ...result, path: filePath } as NodelFileEntry;
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
      const url = safeRemoteNodeUrl(address);
      if (!url) {
        invalid(context, `${path}.address`, 'expected an absolute HTTP(S) node URL without credentials, query, or fragment');
      }
      const result = normalizeOptionalStrings(record, ['name', 'node', 'host'], context, path);
      const name = optionalString(record, 'name', context, path) ?? optionalString(record, 'node', context, path);
      if (!name) {
        invalid(context, path, 'expected a node or name field');
      }
      requireSafeName(name, context, `${path}.name`);
      const host = optionalString(record, 'host', context, path);
      if (host && safeHostRestUrl(host, url)?.host !== url.host) {
        invalid(context, `${path}.host`, 'expected the host from the node address');
      }
      decoded.push({ ...result, address: url.href } as NodelNodeUrlEntry);
    } catch (error) {
      if (!(error instanceof NodelApiDecodeError)) {
        throw error;
      }
      firstError ??= error;
    }
  });
  if (items.length > 0 && decoded.length === 0 && firstError) {
    throw firstError;
  }
  return decoded;
}

export function decodeRecipes(value: unknown, context: string): NodelRecipeEntry[] {
  return asArray(value, context).map((item, index) => {
    const path = `$[${index}]`;
    const record = asRecord(item, context, path);
    if (typeof record.path !== 'string' || record.path.length > MAX_NODE_FILE_PATH_LENGTH || record.path.includes('\\') || unsafePathText.test(record.path)) {
      invalid(context, `${path}.path`, 'expected a relative recipe path');
    }
    if (record.path && !isSafeNodeFilePath(record.path)) {
      invalid(context, `${path}.path`, 'expected a relative recipe path without dot segments');
    }
    optionalTimestamp(record, 'modified', context, path);
    return normalizeOptionalStrings(record, ['path', 'modified', 'readme', 'changelog'], context, path) as unknown as NodelRecipeEntry;
  });
}
