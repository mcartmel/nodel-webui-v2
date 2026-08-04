import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  callNodeAction,
  createNode,
  deleteNodeFile,
  emitNodeSignal,
  executeNodeConsoleCommand,
  getBuildInfo,
  getDiagnosticMeasurements,
  getDiagnostics,
  getHostLogs,
  getLocalRest,
  getNodeActions,
  getNodeActivity,
  getNodeConsoleLogs,
  getNodeDetails,
  getNodeFileContents,
  getNodeParams,
  getNodeParamsSchema,
  getNodeRemoteBindings,
  getNodeRemoteSchema,
  getNodeRestartStatus,
  getNodeSignals,
  getNodeUrlsForNode,
  getRemoteNodeActions,
  getRemoteNodeSignals,
  getToolkit,
  listNodeFiles,
  listRecipes,
  removeCurrentNode,
  renameCurrentNode,
  restartCurrentNode,
  saveNodeFile,
  saveNodeParams,
  saveNodeRemoteBindings,
  searchNodeUrls
} from '../src/api/nodel-host-client';

interface ContractFixture {
  provenance: {
    repository: string;
    commit: string;
    sources: string[];
    apiContract: {
      min: string;
      maxExclusive: string;
    };
    nullableUnionEvidence: {
      emittedByPinnedJavaEndpoint: boolean;
      acceptedBySchemaBoundary: boolean;
      evidence: string;
    };
  };
  transport: {
    restMethods: string[];
    contentType: string;
    cors: string;
  };
  responses: Record<string, unknown>;
}

const fixturePath = resolve(process.cwd(), 'test/fixtures/java-nodel-api.json');
let fixture: ContractFixture;

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

describe('Java Nodel API contract fixtures', () => {
  beforeAll(async () => {
    fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as ContractFixture;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records source provenance and the actual Java transport boundary', () => {
    expect(fixture.provenance).toMatchObject({
      repository: 'museumsvictoria/nodel',
      commit: '19756071383d696682688ab436c77c0a1f80c783',
      apiContract: {
        min: '1.0',
        maxExclusive: '2.0'
      },
      nullableUnionEvidence: {
        emittedByPinnedJavaEndpoint: false,
        acceptedBySchemaBoundary: true,
        evidence: expect.stringContaining('no null union variant')
      }
    });
    expect(fixture.provenance.sources).toEqual(expect.arrayContaining([
      expect.stringContaining('NodelHostHTTPD.java'),
      expect.stringContaining('PyNode.java'),
      expect.stringContaining('BaseNode.java'),
      expect.stringContaining('Schema.java'),
      expect.stringContaining('Value.java'),
      expect.stringContaining('ParameterBindings.java'),
      expect.stringContaining('RemoteBindings.java'),
      expect.stringContaining('Serialisation.java')
    ]));
    expect(fixture.transport).toEqual(expect.objectContaining({
      restMethods: ['GET', 'POST'],
      contentType: 'application/json; charset=utf-8',
      cors: '*'
    }));
  });

  it('captures the representative Java response envelopes used by the UI', () => {
    const responses = fixture.responses;

    expect(responses.localRest).toEqual(expect.objectContaining({
      started: expect.any(String),
      nodes: expect.objectContaining({
        'Contract Node': expect.objectContaining({ name: 'Contract Node' })
      })
    }));
    expect(responses.diagnostics).toEqual(expect.objectContaining({
      hostname: expect.any(String),
      httpAddresses: expect.any(Array),
      uptime: expect.any(Number)
    }));
    expect(responses.diagnosticMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.any(String), isRate: expect.any(Boolean), values: expect.any(Array) })
    ]));
    expect(responses.hostLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ seq: expect.any(Number), timestamp: expect.any(String), message: expect.any(String) })
    ]));
    expect(responses.console).toEqual(expect.arrayContaining([
      expect.objectContaining({ seq: expect.any(Number), console: 'out', comment: expect.any(String) }),
      expect.objectContaining({ console: 'err', comment: '' }),
      expect.objectContaining({ console: 'err', comment: expect.stringMatching(/^\tat /) })
    ]));
    expect(responses.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        seq: expect.any(Number),
        timestamp: expect.any(String),
        source: 'local',
        type: 'event',
        alias: 'Status'
      })
    ]));
    expect(responses.actions).toEqual(expect.objectContaining({
      SetLevel: expect.objectContaining({ name: 'SetLevel', schema: expect.objectContaining({ type: 'integer' }) })
    }));
    expect(responses.events).toEqual(expect.objectContaining({
      Status: expect.objectContaining({ name: 'Status', seq: expect.any(Number), timestamp: expect.any(String) })
    }));
    expect(responses.paramsSchema).toEqual(expect.objectContaining({ type: 'object', properties: expect.any(Object) }));
    expect(responses.remoteSchema).toEqual(expect.objectContaining({ type: 'object', properties: expect.any(Object) }));
    expect(responses.remoteBindings).toEqual(expect.objectContaining({ actions: expect.any(Object), events: expect.any(Object) }));
    const remoteActionSchema = (responses.remoteSchema as any).properties.actions.properties.SetPower.properties;
    expect(remoteActionSchema.node.required).toBe(true);
    expect(remoteActionSchema.action.required).toBe(true);
    expect((responses.remoteSchema as any).properties.actions.properties.UnboundAction.properties.node.required).toBe(true);
    expect((responses.remoteBindings as any).actions.UnboundAction).toEqual({});
    expect((responses.paramsSchema as any).properties.host.group).toBe('Connection');
    expect((responses.paramsSchema as any).properties.port).toMatchObject({ min: 1, max: 65535 });
    expect(responses.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'script.py', modified: expect.any(String) })
    ]));
    expect(responses.nodeUrls).toEqual(expect.arrayContaining([
      expect.objectContaining({ node: expect.any(String), address: expect.stringMatching(/^http:/) })
    ]));
    expect(responses.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.any(String), modified: expect.any(String) })
    ]));
    expect(responses.toolkit).toEqual(expect.objectContaining({ script: expect.any(String) }));
    expect(responses.restartStatus).toEqual(expect.objectContaining({ timestamp: expect.any(String) }));
    expect(responses.writeResult).toBe(true);
    expect(responses.actionResult).toBe(true);
  });

  it('accepts representative Java responses for every read endpoint', async () => {
    const responses = fixture.responses;
    const routes = new Map<string, unknown>([
      ['GET /REST', responses.localRest],
      ['GET /REST/diagnostics', responses.diagnostics],
      ['GET /REST/diagnostics/measurements', responses.diagnosticMeasurements],
      ['GET /build.json', responses.buildInfo],
      ['GET /REST/logs?from=-1&max=200', responses.hostLogs],
      ['GET /REST/toolkit', responses.toolkit],
      ['GET REST/', responses.nodeDetails],
      ['GET REST/hasRestarted?timestamp=2026-08-01T01%3A00%3A00.000Z&timeout=5000', responses.restartStatus],
      ['GET REST/console?from=-1&max=200&timeout=5000', responses.console],
      ['GET REST/activity?from=-1', responses.activity],
      ['GET REST/actions', responses.actions],
      ['GET REST/events', responses.events],
      ['GET REST/params/schema', responses.paramsSchema],
      ['GET REST/params', responses.params],
      ['GET REST/remote/schema', responses.remoteSchema],
      ['GET REST/remote', responses.remoteBindings],
      ['GET REST/files', responses.files],
      ['GET /REST/recipes/list', responses.recipes],
      ['GET http://display.example:8085/nodes/Display/REST/actions', responses.actions],
      ['GET http://display.example:8085/nodes/Display/REST/events', responses.events]
    ]);
    const requests: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      requests.push(`${method} ${url}`);
      if (url === 'REST/files/contents?path=script.py') {
        return new Response(String(responses.fileContents), { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      const response = routes.get(`${method} ${url}`);
      if (response === undefined) {
        throw new Error(`Unexpected contract request: ${method} ${url}`);
      }
      return jsonResponse(response);
    }) as unknown as typeof fetch);

    await expect(getLocalRest()).resolves.toEqual(responses.localRest);
    await expect(getDiagnostics()).resolves.toEqual(responses.diagnostics);
    await expect(getDiagnosticMeasurements()).resolves.toEqual(responses.diagnosticMeasurements);
    await expect(getBuildInfo()).resolves.toEqual(responses.buildInfo);
    await expect(getHostLogs({ from: -1, max: 200 })).resolves.toEqual(responses.hostLogs);
    await expect(getToolkit()).resolves.toEqual(responses.toolkit);
    await expect(getNodeDetails()).resolves.toEqual(responses.nodeDetails);
    await expect(getNodeRestartStatus({ timestamp: '2026-08-01T01:00:00.000Z', timeout: 5000 })).resolves.toEqual(responses.restartStatus);
    await expect(getNodeConsoleLogs({ from: -1, max: 200, timeout: 5000 })).resolves.toEqual(responses.console);
    await expect(getNodeActivity({ from: -1 })).resolves.toEqual(responses.activity);
    await expect(getNodeActions()).resolves.toEqual(responses.actions);
    await expect(getNodeSignals()).resolves.toEqual(responses.events);
    await expect(getNodeParamsSchema()).resolves.toEqual(responses.paramsSchema);
    await expect(getNodeParams()).resolves.toEqual(responses.params);
    await expect(getNodeRemoteSchema()).resolves.toEqual(responses.remoteSchema);
    await expect(getNodeRemoteBindings()).resolves.toEqual(responses.remoteBindings);
    await expect(listNodeFiles()).resolves.toEqual((responses.files as Array<Record<string, unknown>>).map((entry) => ({
      ...entry,
      compatibility: 'portable'
    })));
    await expect(getNodeFileContents('script.py')).resolves.toBe(responses.fileContents);
    await expect(listRecipes()).resolves.toEqual((responses.recipes as Array<Record<string, unknown>>).map((entry) => ({
      ...entry,
      compatibility: 'portable'
    })));
    await expect(getRemoteNodeActions('http://display.example:8085/nodes/Display/')).resolves.toEqual(responses.actions);
    await expect(getRemoteNodeSignals('http://display.example:8085/nodes/Display/')).resolves.toEqual(responses.events);
    expect(requests).toHaveLength(21);
  });

  it('preserves Java-compatible request methods and payload shapes', async () => {
    const responses = fixture.responses;
    const calls: Array<{ method: string; url: string; contentType: string | null; body: unknown }> = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      const contentType = new Headers(init?.headers).get('Content-Type');
      let body: unknown = init?.body ?? null;
      if (typeof body === 'string' && contentType?.includes('application/json')) {
        body = JSON.parse(body);
      }
      calls.push({ method, url, contentType, body });

      if (url === '/REST/nodeURLs' || url === '/REST/nodeURLsForNode') {
        return jsonResponse(responses.nodeUrls);
      }
      if (url.includes('/actions/')) {
        return jsonResponse(responses.actionResult);
      }
      return jsonResponse(responses.writeResult);
    }) as unknown as typeof fetch);

    const params = { host: '127.0.0.1', port: 9000 };
    const remote = {
      actions: { SetPower: { node: 'Display', action: 'Power' } },
      events: { SourceStatus: { node: 'Display', event: 'Status' } }
    };

    await expect(renameCurrentNode('Renamed Contract Node')).resolves.toBe(true);
    await expect(restartCurrentNode()).resolves.toBe(true);
    await expect(removeCurrentNode()).resolves.toBe(true);
    await expect(executeNodeConsoleCommand('print("contract")')).resolves.toBe(true);
    await expect(callNodeAction('Set Level', { arg: 42 })).resolves.toBe(true);
    await expect(emitNodeSignal('Status Changed', { arg: 'Ready' })).resolves.toBe(true);
    await expect(saveNodeParams(params)).resolves.toBe(true);
    await expect(saveNodeRemoteBindings(remote)).resolves.toBe(true);
    await expect(saveNodeFile('script.py', 'print("contract")')).resolves.toBe(true);
    await expect(saveNodeFile('content/control.html', '<nodel-app></nodel-app>')).resolves.toBe(true);
    await expect(deleteNodeFile('content/control.html')).resolves.toBe(true);
    await expect(searchNodeUrls('Display')).resolves.toEqual(responses.nodeUrls);
    await expect(getNodeUrlsForNode('Display')).resolves.toEqual(responses.nodeUrls);
    await expect(createNode('Contract Copy', 'displays/projector')).resolves.toBe(true);

    expect(calls).toEqual([
      { method: 'POST', url: 'REST/rename', contentType: 'application/json', body: { value: 'Renamed Contract Node' } },
      { method: 'GET', url: 'REST/restart', contentType: null, body: null },
      { method: 'GET', url: 'REST/remove?confirm=true', contentType: null, body: null },
      { method: 'POST', url: 'REST/exec', contentType: 'application/json', body: { code: 'print("contract")' } },
      { method: 'POST', url: 'REST/actions/Set%20Level/call', contentType: 'application/json', body: { arg: 42 } },
      { method: 'POST', url: 'REST/events/Status%20Changed/emit', contentType: 'application/json', body: { arg: 'Ready' } },
      { method: 'POST', url: 'REST/params/save', contentType: 'application/json', body: params },
      { method: 'POST', url: 'REST/remote/save', contentType: 'application/json', body: remote },
      { method: 'POST', url: 'REST/script/save', contentType: 'application/json', body: { script: 'print("contract")' } },
      { method: 'POST', url: 'REST/files/save?path=content%2Fcontrol.html', contentType: 'application/octet-stream', body: '<nodel-app></nodel-app>' },
      { method: 'GET', url: 'REST/files/delete?path=content%2Fcontrol.html', contentType: null, body: null },
      { method: 'POST', url: '/REST/nodeURLs', contentType: 'application/json', body: { filter: 'Display' } },
      { method: 'POST', url: '/REST/nodeURLsForNode', contentType: 'application/json', body: { name: 'Display' } },
      { method: 'POST', url: '/REST/newNode', contentType: 'application/json', body: { value: 'Contract Copy', base: 'displays/projector' } }
    ]);
  });

  it('captures both Java activity WebSocket envelope forms', () => {
    const activityRows = fixture.responses.activity as Array<Record<string, unknown>> | undefined;
    const history = fixture.responses.activityWebSocketHistory as Record<string, unknown>;
    const live = fixture.responses.activityWebSocketLive as Record<string, unknown>;

    const historyRows = history.activityHistory as Array<Record<string, unknown>> | undefined;
    const initialBinding = historyRows?.find((entry) => entry.seq === 0 && entry.type === 'actionBinding');
    const initialLocalAction = activityRows?.find((entry) => entry.seq === 0 && entry.type === 'action' && entry.source === 'local' && entry.alias === 'ActionState');

    expect(history.node).toBe('Contract Node');
    expect(history.activityHistory).toEqual(expect.any(Array));
    expect(initialBinding).toEqual({ seq: 0, source: 'remote', type: 'actionBinding', alias: 'SetPower', arg: 'Empty' });
    expect(initialLocalAction).toEqual({ seq: 0, source: 'local', type: 'action', alias: 'ActionState' });
    expect(live.node).toBe('Contract Node');
    expect(live.activity).toEqual(expect.objectContaining({ seq: 202, alias: 'Power' }));
  });
});
