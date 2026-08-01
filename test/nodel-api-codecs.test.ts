import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MAX_API_COLLECTION_ITEMS,
  NodelApiDecodeError,
  decodeActions,
  decodeActivityLogs,
  decodeActivityWebSocketMessage,
  decodeBuildInfo,
  decodeConsoleLogs,
  decodeDiagnosticMeasurements,
  decodeDiagnostics,
  decodeFiles,
  decodeHostLogs,
  decodeLocalRest,
  decodeNodeDetails,
  decodeNodeUrls,
  decodeRecipes,
  decodeRecord,
  decodeRemoteBindings,
  decodeRestartStatus,
  decodeSchema,
  decodeSignals,
  decodeToolkit
} from '../src/api/codecs/nodel-codecs';
import { assertSafeNodeFilePath } from '../src/utils/node-file-path';

let responses: Record<string, unknown>;

describe('Nodel API response codecs', () => {
  beforeAll(async () => {
    const fixture = JSON.parse(await readFile(resolve(process.cwd(), 'test/fixtures/java-nodel-api.json'), 'utf8')) as { responses: Record<string, unknown> };
    responses = fixture.responses;
  });

  it('accepts every representative Java Nodel response fixture', () => {
    expect(decodeLocalRest(responses.localRest, 'local')).toMatchObject({ nodes: expect.any(Object) });
    expect(decodeDiagnostics(responses.diagnostics, 'diagnostics')).toMatchObject({ hostname: 'NODEL-CONTRACT' });
    expect(decodeDiagnosticMeasurements(responses.diagnosticMeasurements, 'measurements')).toHaveLength(2);
    expect(decodeBuildInfo(responses.buildInfo, 'build')).toMatchObject({ project: 'nodel' });
    expect(decodeHostLogs(responses.hostLogs, 'logs')).toHaveLength(1);
    expect(decodeToolkit(responses.toolkit, 'toolkit').script).toContain('Contract toolkit');
    expect(decodeNodeDetails(responses.nodeDetails, 'node')).toMatchObject({ name: 'Contract Node' });
    expect(decodeRestartStatus(responses.restartStatus, 'restart').timestamp).toBeTypeOf('string');
    expect(decodeConsoleLogs(responses.console, 'console')).toHaveLength(2);
    expect(decodeActivityLogs(responses.activity, 'activity')).toHaveLength(2);
    expect(decodeActivityWebSocketMessage(responses.activityWebSocketHistory, 'websocket').activityHistory).toHaveLength(1);
    expect(decodeActivityWebSocketMessage(responses.activityWebSocketLive, 'websocket').activity?.seq).toBe(202);
    expect(Object.keys(decodeActions(responses.actions, 'actions'))).toContain('SetLevel');
    expect(Object.keys(decodeSignals(responses.events, 'events'))).toContain('Status');
    expect(decodeSchema(responses.paramsSchema, 'params schema').type).toBe('object');
    expect(decodeRecord(responses.params, 'params')).toMatchObject({ port: 9000 });
    expect(decodeSchema(responses.remoteSchema, 'remote schema').type).toBe('object');
    expect(decodeRemoteBindings(responses.remoteBindings, 'remote')).toMatchObject({ actions: expect.any(Object), events: expect.any(Object) });
    expect(decodeFiles(responses.files, 'files')).toHaveLength(3);
    expect(decodeNodeUrls(responses.nodeUrls, 'node urls')).toHaveLength(2);
    expect(decodeRecipes(responses.recipes, 'recipes')).toHaveLength(1);
  });

  it('rejects malformed required fields and unsafe backend URLs and paths', () => {
    const timestamp = '2026-08-01T00:00:00Z';
    expect(() => decodeActivityLogs([{ seq: Number.NaN, timestamp, source: 'local', type: 'event', alias: 'Status' }], 'activity')).toThrow(NodelApiDecodeError);
    expect(() => decodeActivityLogs([{ seq: 1, timestamp, source: 'unknown', type: 'event', alias: 'Status' }], 'activity')).toThrow('$[0].source');
    expect(() => decodeActivityLogs([{ seq: 1, timestamp: 'not-a-date', source: 'local', type: 'event', alias: 'Status' }], 'activity')).toThrow('valid timestamp');
    expect(() => decodeConsoleLogs([{ seq: 1, timestamp, console: 'debug', comment: 'line' }], 'console')).toThrow('$[0].console');
    expect(() => decodeDiagnosticMeasurements([{ name: 'Metric', isRate: false, values: [Number.POSITIVE_INFINITY] }], 'measurements')).toThrow('finite number');
    expect(() => decodeSchema({ type: 'unsupported' }, 'schema')).toThrow('supported JSON schema type');
    expect(() => decodeActions({ Broken: { name: 42 } }, 'actions')).toThrow('non-empty string');
    expect(() => decodeActions({ Broken: { name: 'Broken', seq: 1.5 } }, 'actions')).toThrow('non-negative safe integer');
    expect(() => decodeSignals({ Broken: { name: 'Broken', timestamp: 'not-a-date' } }, 'signals')).toThrow('valid timestamp');
    expect(() => decodeBuildInfo({ date: 'not-a-date' }, 'build')).toThrow('valid timestamp');
    expect(() => decodeRestartStatus({ timestamp: 'not-a-date' }, 'restart')).toThrow('timestamp');
    expect(() => decodeNodeUrls([{ node: 'Unsafe', address: 'javascript:alert(1)' }], 'node urls')).toThrow('absolute HTTP(S)');
    expect(() => decodeBuildInfo({ origin: 'https://user:secret@example.test/repo' }, 'build')).toThrow('without credentials');
    expect(() => decodeFiles([{ path: '../secret.py' }], 'files')).toThrow('safe relative node file path');
    expect(() => assertSafeNodeFilePath('content/../secret.py')).toThrow('Node file path is invalid');
    expect(() => assertSafeNodeFilePath('C:/outside/script.py')).toThrow('Node file path is invalid');
    expect(() => assertSafeNodeFilePath('content/script.py:stream')).toThrow('Node file path is invalid');
  });

  it('preserves the Java variant-schema dialect and explicit null type', () => {
    expect(decodeSchema({ type: null }, 'schema').type).toBeNull();
    expect(decodeSchema({ type: [{ type: 'string' }, { type: 'null' }] }, 'schema').type).toEqual([
      { type: 'string' },
      { type: 'null' }
    ]);
    expect(() => decodeSchema({ type: ['string', 'null'] }, 'schema')).toThrow('expected an object');
    expect(() => decodeSchema({ type: 'string', required: null }, 'schema')).toThrow('required');
    expect(() => decodeSchema({ type: 'number', min: null }, 'schema')).toThrow('min');
    expect(() => decodeSchema({ type: 'number', step: 0 }, 'schema')).toThrow('step');
    expect(() => decodeSchema({ type: 'string', enum: [{ value: 'unsupported' }] }, 'schema')).toThrow('enum');
    expect(() => decodeSchema({ type: 'string', enum: [] }, 'schema')).toThrow('enum');
    expect(() => decodeSchema({ type: 'number', min: 5, max: 1 }, 'schema')).toThrow('minimum');
  });

  it('isolates malformed discovery entries when valid advertisements remain', () => {
    expect(decodeNodeUrls([
      { node: 'Unsafe', address: 'javascript:alert(1)' },
      { node: 'Display', address: 'https://display.test/nodes/Display/' }
    ], 'node urls')).toEqual([{ node: 'Display', address: 'https://display.test/nodes/Display/' }]);
    expect(decodeNodeUrls([{ node: 'Display', address: 'https://display.test/nodes/Display/', host: 'DISPLAY.TEST' }], 'node urls')).toHaveLength(1);
    expect(() => decodeNodeUrls([{ node: 'Display', address: 'https://display.test/nodes/Display/', host: 'display.test\\admin' }], 'node urls')).toThrow('host from the node address');
  });

  it('bounds backend-provided WebSocket error text', () => {
    const message = decodeActivityWebSocketMessage({ error: `  ${'x'.repeat(800)}\nmore` }, 'websocket');
    expect(message.error).toHaveLength(500);
    expect(message.error).not.toContain('\n');
  });

  it('rejects oversized collections and excessively deep schemas', () => {
    expect(() => decodeFiles(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, () => ({ path: 'script.py' })), 'files')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeNodeUrls(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, () => ({ node: 'Node', address: 'https://example.test/nodes/Node/' })), 'nodes')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeActivityLogs(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, () => ({})), 'activity')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeDiagnosticMeasurements([{ name: 'Metric', isRate: false, values: Array(MAX_API_COLLECTION_ITEMS + 1).fill(1) }], 'measurements')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeSchema({ type: 'string', enum: Array(MAX_API_COLLECTION_ITEMS + 1).fill('value') }, 'schema')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeDiagnostics({ httpAddresses: Array(MAX_API_COLLECTION_ITEMS + 1).fill('https://example.test/') }, 'diagnostics')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    const oversizedDefinitions = Object.fromEntries(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, (_, index) => [`Action${index}`, { name: `Action${index}` }]));
    expect(() => decodeActions(oversizedDefinitions, 'actions')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeRemoteBindings({ actions: oversizedDefinitions }, 'bindings')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeRecord({ nested: Array(MAX_API_COLLECTION_ITEMS + 1).fill(null) }, 'params')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);

    let schema: Record<string, unknown> = { type: 'string' };
    for (let index = 0; index < 34; index += 1) {
      schema = { type: 'object', properties: { nested: schema } };
    }
    expect(() => decodeSchema(schema, 'schema')).toThrow('schema exceeds 32 levels');
  });

  it('bounds unknown remote-binding metadata before preserving it', () => {
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 66; index += 1) deep = { nested: deep };
    expect(() => decodeRemoteBindings({ metadata: deep }, 'bindings')).toThrow('64 levels');
    expect(() => decodeRemoteBindings({ sectionMetadata: Array(MAX_API_COLLECTION_ITEMS + 1).fill(null) }, 'bindings')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeRemoteBindings({ actions: { Row: { metadata: Array(MAX_API_COLLECTION_ITEMS + 1).fill(null) } } }, 'bindings')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeRemoteBindings({ metadata: Number.NaN }, 'bindings')).toThrow('finite JSON number');
    expect(() => decodeRemoteBindings({ actions: { Row: { metadata: Number.POSITIVE_INFINITY } } }, 'bindings')).toThrow('finite JSON number');

    const metadata = { nested: [{ keep: true }] };
    const decoded = decodeRemoteBindings({ metadata, actions: { Row: { node: 'Display', metadata } } }, 'bindings');
    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.metadata).not.toBe(metadata);
    expect((decoded.actions as Record<string, any>).Row.metadata).toEqual(metadata);
  });

  it('uses bounded structural errors without reflecting hostile payload values', () => {
    const secret = 'do-not-reflect-this-secret';
    let error: unknown;
    try {
      decodeNodeUrls([{ node: 'Unsafe', address: `javascript:${secret}` }], 'POST /REST/nodeURLs');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NodelApiDecodeError);
    expect((error as Error).message.length).toBeLessThanOrEqual(500);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).toContain('POST /REST/nodeURLs');
  });
});
