import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MAX_API_COLLECTION_ITEMS,
  MAX_DIAGNOSTIC_MEASUREMENT_SAMPLES,
  MAX_DIAGNOSTIC_MEASUREMENT_TOTAL_SAMPLES,
  MAX_DIAGNOSTIC_MEASUREMENTS,
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

function compatibilityFixture() {
  return responses.compatibility221 as {
    displayStrings: string[];
    emptySchema: Record<string, never>;
    restartStatusNull: Record<string, never>;
    httpAddresses: string[];
    nodeUrls: Array<Record<string, string>>;
    gitOrigins: string[];
  };
}

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
    expect(decodeConsoleLogs(responses.console, 'console')).toHaveLength(5);
    const decodedActivity = decodeActivityLogs(responses.activity, 'activity');
    expect(decodedActivity).toHaveLength(3);
    expect(decodedActivity.some((entry) => entry.timestamp === undefined)).toBe(true);

    const decodedActivityHistory = decodeActivityWebSocketMessage(responses.activityWebSocketHistory, 'websocket').activityHistory;
    expect(decodedActivityHistory).toHaveLength(2);
    expect(decodedActivityHistory?.some((entry) => entry.timestamp === undefined)).toBe(true);
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
    expect(decodeActivityLogs([{ seq: 1, source: 'local', type: 'event', alias: 'Status' }], 'activity')[0]).toMatchObject({ seq: 1, source: 'local', type: 'event', alias: 'Status' });
    expect(decodeActivityLogs([{ seq: 1, timestamp: null, source: 'local', type: 'event', alias: 'Status' }], 'activity')[0].timestamp).toBeUndefined();
    expect(decodeActivityLogs([{ seq: 1, timestamp: '2026-08-01T00:00:00Z', source: 'local', type: 'event', alias: 'Status' }], 'activity')[0].timestamp).toBe('2026-08-01T00:00:00Z');
    expect(() => decodeActivityLogs([{ seq: 1, timestamp: '', source: 'local', type: 'event', alias: 'Status' }], 'activity')).toThrow('non-empty string');

    const malformedTimestamps: Array<{ label: string; value: string }> = [];
    const baseTimestamp = '2026-08-01T00:00:00Z';
    for (let code = 0; code < 0x20; code += 1) {
      const character = String.fromCharCode(code);
      const label = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
      malformedTimestamps.push({ label: `${label} prefix`, value: `${character}${baseTimestamp}` });
      malformedTimestamps.push({ label: `${label} middle`, value: `2026-08-01T00${character}00:00Z` });
      malformedTimestamps.push({ label: `${label} suffix`, value: `${baseTimestamp}${character}` });
    }
    const del = '\u007f';
    malformedTimestamps.push({ label: 'U+007F prefix', value: `${del}2026-08-01T00:00:00Z` });
    malformedTimestamps.push({ label: 'U+007F middle', value: `2026-08-01T00${del}00:00Z` });
    malformedTimestamps.push({ label: 'U+007F suffix', value: `2026-08-01T00:00:00Z${del}` });
    for (const { label, value } of malformedTimestamps) {
      expect(() => decodeActivityLogs([{ seq: 1, timestamp: value, source: 'local', type: 'event', alias: 'Status' }], 'activity'), `rejects malformed timestamp ${label}`).toThrow();
    }
    expect(() => decodeActivityLogs([{ seq: 1, timestamp: 'not-a-date', source: 'local', type: 'event', alias: 'Status' }], 'activity')).toThrow('valid timestamp');
    expect(() => decodeConsoleLogs([{ seq: 1, timestamp, console: 'debug', comment: 'line' }], 'console')).toThrow('$[0].console');
    expect(() => decodeDiagnosticMeasurements([{ name: 'Metric', isRate: false, values: [Number.POSITIVE_INFINITY] }], 'measurements')).toThrow('finite number');
    expect(() => decodeSchema({ type: 'unsupported' }, 'schema')).toThrow('supported JSON schema type');
    expect(() => decodeActions({ Broken: { name: 42 } }, 'actions')).toThrow('point name');
    expect(() => decodeActions({ Broken: { name: 'Broken', seq: 1.5 } }, 'actions')).toThrow('non-negative safe integer');
    expect(() => decodeSignals({ Broken: { name: 'Broken', timestamp: 'not-a-date' } }, 'signals')).toThrow('valid timestamp');
    expect(() => decodeBuildInfo({ date: 'not-a-date' }, 'build')).toThrow('valid timestamp');
    expect(() => decodeRestartStatus({ timestamp: 'not-a-date' }, 'restart')).toThrow('timestamp');
    expect(() => decodeNodeUrls([{ node: 'Unsafe', address: 'javascript:alert(1)' }], 'node urls')).toThrow('absolute HTTP(S)');
    expect(decodeBuildInfo({ origin: 'https://user:secret@example.test/repo' }, 'build').origin).toBe('https://user:secret@example.test/repo');
    expect(() => decodeFiles([{ path: '../secret.py' }], 'files')).toThrow('safe relative node file path');
    expect(() => assertSafeNodeFilePath('content/../secret.py')).toThrow('Node file path is invalid');
    expect(() => assertSafeNodeFilePath('C:/outside/script.py')).toThrow('Node file path is invalid');
    expect(() => assertSafeNodeFilePath('content/script.py:stream')).toThrow('Node file path is invalid');
  });

  it('classifies exact legacy Java file and recipe names without rewriting them', () => {
    const longPath = `${'a'.repeat(1025)}.txt`;
    const legacyPaths = [
      'content/script.py:stream',
      'content\\backslash.txt',
      'content/line\nbreak.txt',
      'content/control\u0001name.txt',
      'content/cafe\u0301.txt',
      'content/unpaired\ud800name.txt',
      longPath
    ];
    const files = decodeFiles(legacyPaths.map((path) => ({ path })), 'files');
    expect(files.map((file) => file.path)).toEqual(legacyPaths);
    expect(files.map((file) => file.compatibility)).toEqual(Array(legacyPaths.length).fill('legacy'));

    const recipes = decodeRecipes([{ path: '' }, ...legacyPaths.map((path) => ({ path }))], 'recipes');
    expect(recipes.map((recipe) => recipe.path)).toEqual(['', ...legacyPaths]);
    expect(recipes.map((recipe) => recipe.compatibility)).toEqual(['portable', ...Array(legacyPaths.length).fill('legacy')]);

    for (const path of ['', '/absolute.txt', '\\absolute.txt', 'C:x', 'C:/x', '\\\\server\\share', '../secret.txt', 'content/../secret.txt', 'content\\..\\secret.txt', 'content//empty.txt', 'content\u0000nul.txt']) {
      expect(() => decodeFiles([{ path }], 'files'), path || 'empty').toThrow(NodelApiDecodeError);
    }
    for (const path of ['/absolute', '\\absolute', 'C:x', 'content/../secret', 'content\\..\\secret', 'content//empty', 'content\u0000nul']) {
      expect(() => decodeRecipes([{ path }], 'recipes'), path).toThrow(NodelApiDecodeError);
    }
  });

  it('preserves Java console display text including empty lines and stack formatting', () => {
    const timestamp = '2026-08-01T00:00:00Z';
    const comments = [...compatibilityFixture().displayStrings, '\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)', 'first line\nsecond line\r\n'];
    const decoded = decodeConsoleLogs(comments.map((comment, index) => ({
      seq: index + 1,
      timestamp,
      console: index === 0 ? 'err' : 'out',
      comment
    })), 'console');

    expect(decoded.map((entry) => entry.comment)).toEqual(comments);
  });

  it('preserves arbitrary display strings while keeping identifiers strict', () => {
    const [empty, text] = compatibilityFixture().displayStrings;
    expect(decodeHostLogs([{ seq: 1, timestamp: '2026-08-01T00:00:00Z', message: text, error: empty }], 'logs')[0]).toMatchObject({ message: text, error: empty });
    expect(decodeLocalRest({ nodes: { Node: { name: 'Node', desc: text } } }, 'local').nodes?.Node.desc).toBe(text);
    expect(decodeNodeDetails({ name: 'Node', desc: text }, 'node').desc).toBe(text);
    expect(decodeSchema({ type: 'string', title: text, desc: text, group: text, caution: text, hint: text }, 'schema')).toMatchObject({ title: text, desc: text, group: text, caution: text, hint: text });
    expect(decodeActions({ Action: { name: 'Action', title: text, desc: text, group: text, caution: text } }, 'actions').Action).toMatchObject({ title: text, desc: text, group: text, caution: text });
    expect(decodeSignals({ Signal: { name: 'Signal', title: text, desc: text, group: text, caution: text } }, 'signals').Signal).toMatchObject({ title: text, desc: text, group: text, caution: text });
    expect(decodeRecipes([{ path: 'recipe', readme: text, changelog: empty }], 'recipes')[0]).toMatchObject({ readme: text, changelog: empty });
    expect(decodeActivityWebSocketMessage({ error: text }, 'websocket').error).toBe(text);
    expect(() => decodeActions({ ['Action\u0000']: { name: 'Action\u0000' } }, 'actions')).toThrow('control characters');
  });

  it('deletes absent and null display fields during composed normalization', () => {
    const node = decodeNodeDetails({ name: 'Node', desc: null }, 'node');
    const schema = decodeSchema({ type: 'string', title: null, desc: null }, 'schema');
    const socket = decodeActivityWebSocketMessage({ error: null }, 'websocket');
    const recipe = decodeRecipes([{ path: 'recipe', readme: null, changelog: null }], 'recipes')[0];
    const action = decodeActions({ Action: { name: 'Action', title: null, desc: null } }, 'actions').Action;
    const hostLog = decodeHostLogs([{ seq: 1, timestamp: '2026-08-01T00:00:00Z', message: null, error: null }], 'logs')[0];

    for (const [value, key] of [[node, 'desc'], [schema, 'title'], [schema, 'desc'], [socket, 'error'], [recipe, 'readme'], [recipe, 'changelog'], [action, 'title'], [action, 'desc'], [hostLog, 'message']] as const) {
      expect(Object.prototype.hasOwnProperty.call(value, key)).toBe(false);
    }
    expect(hostLog.error).toBeNull();
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

  it('normalizes legacy scalar schema hints to placeholder strings', () => {
    const schema = decodeSchema({
      type: 'object',
      properties: {
        port: {
          type: 'integer',
          hint: 9999
        }
      }
    }, 'schema');

    expect(schema.properties?.port.hint).toBe('9999');
    expect(() => decodeSchema({ type: 'string', hint: Number.NaN }, 'schema')).toThrow('hint');
  });

  it('isolates malformed discovery entries when valid advertisements remain', () => {
    expect(decodeNodeUrls([
      { node: 'Unsafe', address: 'javascript:alert(1)' },
      { node: 'Display', address: 'https://display.test/nodes/Display/' }
    ], 'node urls')).toEqual([{ node: 'Display', address: 'https://display.test/nodes/Display/' }]);
    expect(decodeNodeUrls([{ node: 'Display', address: 'https://display.test/nodes/Display/', host: 'DISPLAY.TEST' }], 'node urls')).toHaveLength(1);
    expect(decodeNodeUrls([{ node: '\ufeff', address: 'https://display.test/nodes/%EF%BB%BF/' }], 'node urls')[0]?.node).toBe('\ufeff');
    expect(decodeLocalRest({ nodes: { '\ufeff': { name: '\ufeff' } } }, 'local').nodes?.['\ufeff'].name).toBe('\ufeff');
    expect(decodeActions({ '\ufeff': { name: '\ufeff' } }, 'actions')['\ufeff'].name).toBe('\ufeff');
    expect(decodeSignals({ '\ufeff': { name: '\ufeff' } }, 'events')['\ufeff'].name).toBe('\ufeff');
    expect(decodeActivityLogs([{ seq: 1, source: 'local', type: 'event', alias: '\ufeff' }], 'activity')[0].alias).toBe('\ufeff');
    expect(() => decodeNodeUrls([{ node: 'Display', address: 'https://display.test/nodes/Display/', host: 'display.test\\admin' }], 'node urls')).toThrow('host from the node address');
    for (const address of [
      'http://[::1:8085/nodes/Display/',
      'http://user@::1:8085/nodes/Display/',
      'http://::1:65536/nodes/Display/',
      'http://::1:8085/nodes/Display/?query',
      'http://::1:8085/nodes/Display/#fragment'
    ]) {
      expect(() => decodeNodeUrls([{ node: 'Display', address }], 'node urls'), address).toThrow('absolute HTTP(S)');
    }
  });

  it('preserves Java IPv6 ports and address hextets during node URL decoding', () => {
    expect(decodeNodeUrls([
      { node: 'Port Eight', address: 'http://::1:8/nodes/PortEight/', host: '::1' },
      { node: 'Address Hextet', address: 'http://2001:db8::8/nodes/AddressHextet/' },
      { node: 'Compressed Port Eight', address: 'http://2001:db8:::8/nodes/CompressedPortEight/', host: '2001:db8:::8' },
      { node: 'Bracketed Port Eight', address: 'http://[::1]:8/nodes/BracketedPortEight/', host: '[::1]:8' }
    ], 'node urls').map((entry) => entry.address)).toEqual([
      'http://[::1]:8/nodes/PortEight/',
      'http://[2001:db8::8]/nodes/AddressHextet/',
      'http://[2001:db8::]:8/nodes/CompressedPortEight/',
      'http://[::1]:8/nodes/BracketedPortEight/'
    ]);
    expect(decodeDiagnostics({ httpAddresses: ['http://::1:8/REST', 'http://2001:db8:::8/REST'] }, 'diagnostics').httpAddresses).toEqual([
      'http://[::1]:8/REST',
      'http://[2001:db8::]:8/REST'
    ]);
  });

  it('bounds backend-provided WebSocket error text', () => {
    const error = `  ${'x'.repeat(800)}\nmore`;
    expect(decodeActivityWebSocketMessage({ error }, 'websocket').error).toBe(error);
  });

  it('accepts Java 2.2.1 empty, IPv6, restart, and Git-origin variants', () => {
    const compatibility = compatibilityFixture();
    expect(decodeSchema(compatibility.emptySchema, 'schema')).toEqual({});
    expect(decodeRestartStatus(compatibility.restartStatusNull, 'restart').timestamp).toBeNull();
    expect(decodeDiagnostics({ httpAddresses: compatibility.httpAddresses }, 'diagnostics').httpAddresses).toEqual([
      'http://[::1]:8085/REST',
      'http://[fe80::1%25eth0]:8085/REST'
    ]);
    expect(decodeNodeUrls(compatibility.nodeUrls, 'node urls').map((entry) => entry.address)).toEqual([
      'http://[::1]:8085/nodes/IPv6/',
      'http://[fe80::1%25eth0]:8085/nodes/Scoped/'
    ]);
    for (const origin of compatibility.gitOrigins) {
      expect(decodeBuildInfo({ origin }, 'build').origin).toBe(origin);
    }
  });

  it('normalizes missing and null restart timestamps while rejecting malformed present values', () => {
    expect(decodeRestartStatus({}, 'restart')).toEqual({ timestamp: null });
    expect(decodeRestartStatus({ timestamp: null }, 'restart')).toEqual({ timestamp: null });
    expect(() => decodeRestartStatus({ timestamp: 0 }, 'restart')).toThrow('timestamp');
  });

  it('rejects oversized collections and excessively deep schemas', () => {
    expect(() => decodeFiles(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, () => ({ path: 'script.py' })), 'files')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeNodeUrls(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, () => ({ node: 'Node', address: 'https://example.test/nodes/Node/' })), 'nodes')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeActivityLogs(Array.from({ length: MAX_API_COLLECTION_ITEMS + 1 }, () => ({})), 'activity')).toThrow(`at most ${MAX_API_COLLECTION_ITEMS}`);
    expect(() => decodeDiagnosticMeasurements(Array.from({ length: MAX_DIAGNOSTIC_MEASUREMENTS + 1 }, (_, index) => ({ name: `Metric${index}`, isRate: false, values: [] })), 'measurements')).toThrow(`at most ${MAX_DIAGNOSTIC_MEASUREMENTS}`);
    expect(() => decodeDiagnosticMeasurements([{ name: 'Metric', isRate: false, values: Array(MAX_DIAGNOSTIC_MEASUREMENT_SAMPLES + 1).fill(1) }], 'measurements')).toThrow(`at most ${MAX_DIAGNOSTIC_MEASUREMENT_SAMPLES}`);
    expect(() => decodeDiagnosticMeasurements(Array.from({ length: 11 }, (_, index) => ({ name: `Metric${index}`, isRate: false, values: Array(Math.ceil(MAX_DIAGNOSTIC_MEASUREMENT_TOTAL_SAMPLES / 10)).fill(1) })), 'measurements')).toThrow(`at most ${MAX_DIAGNOSTIC_MEASUREMENT_TOTAL_SAMPLES}`);
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

  it('rejects duplicate diagnostic measurement names', () => {
    expect(() => decodeDiagnosticMeasurements([
      { name: 'Runtime.cpu', isRate: false, values: [1] },
      { name: 'Runtime.cpu', isRate: true, values: [2] }
    ], 'measurements')).toThrow('unique measurement name');
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
