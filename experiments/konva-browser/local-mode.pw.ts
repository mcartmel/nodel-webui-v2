import { expect, test, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { extname, relative, resolve, sep } from 'node:path';

const artifactDir = resolve('artifacts/konva-local');
const headerIndicatorArtifactDir = resolve(artifactDir, 'header-indicators');
const localInventory = {
  nodes: {
    Controller: {},
    'Touch Panel': {},
    Scheduler: {},
    'Idle Local': {}
  }
};

const ownerBindings: Record<string, unknown> = {
  Controller: {
    actions: {
      'Power On': { node: 'Projector Left', action: 'Power On' },
      'Self Call': { node: 'Controller', action: 'Self Call' },
      Unassigned: { node: 'Unset Target' }
    },
    events: { 'Power State': { node: 'Projector Left', event: 'Power State' } }
  },
  'Touch Panel': { actions: { 'Turn Projector On': { node: 'Projector Left', action: 'Power On' } } },
  Scheduler: { events: { 'Controller Ready': { node: 'Controller', event: 'Ready' } } },
  'Idle Local': {},
  'Canonical Owner': {},
  'Canonical Owner ()': {}
};

type RequestRecord = { method: string; pathname: string; search: string };
const experimentOrigin = new URL(process.env.KONVA_EXPERIMENT_URL ?? 'http://127.0.0.1:4181').origin;

type SelfLoopScene = {
  edgeId: string;
  groupPosition: { x: number; y: number };
  from: { x: number; y: number };
  to: { x: number; y: number };
  curves: Array<{ start: { x: number; y: number }; control1: { x: number; y: number }; control2: { x: number; y: number }; end: { x: number; y: number }; strokeStyle: string }>;
  screenMidpoint: { x: number; y: number };
  fromSocket: { fill: string; stroke: string };
  toSocket: { fill: string; stroke: string };
  otherSocket: { fill: string; stroke: string };
  accent: string;
};

async function readControllerSelfLoop(page: Page): Promise<SelfLoopScene> {
  return page.evaluate(() => {
    type NativeNode = {
      id(): string;
      name(): string;
      x(): number;
      y(): number;
      width(): number;
      text(): string;
      align(): string;
      fill(): string;
      stroke(): string;
      find(selector: string): NativeNode[];
      getAbsolutePosition(top?: NativeNode): { x: number; y: number };
      getHitFunc(): (context: {
        beginPath(): void;
        moveTo(x: number, y: number): void;
        bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
        lineTo(x: number, y: number): void;
        closePath(): void;
        stroke(): void;
        fill(): void;
        strokeShape(shape: NativeNode): void;
        fillShape(shape: NativeNode): void;
        strokeStyle: string;
        fillStyle: string;
        lineWidth: number;
      }, shape: NativeNode) => void;
    };
    type CurvePath = {
      start: { x: number; y: number };
      control1?: { x: number; y: number };
      control2?: { x: number; y: number };
      end?: { x: number; y: number };
      strokeStyle: string;
    };
    const stage = (window as Window & { Konva?: { stages?: NativeNode[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const controller = cards.find((card) => card.find('Text').some((text) => text.text() === 'Controller'));
    if (!controller) throw new Error('Controller card was not found');
    const texts = controller.find('Text');
    const inputText = texts.find((text) => text.text() === 'Self Call' && text.align() === 'left');
    const outputText = texts.find((text) => text.text() === 'Self Call' && text.align() === 'right');
    const otherText = texts.find((text) => text.text() === 'Power On' && text.align() === 'right');
    if (!inputText || !outputText || !otherText) throw new Error('Expected local, remote, and unmatched port labels were not found');
    const background = controller.find('Rect').find((rect) => rect.width() > 100);
    if (!background) throw new Error('Controller background rectangle was not found');
    const cardWidth = background.width();
    const socketNear = (text: NativeNode, side: 'left' | 'right') => {
      const sockets = controller.find('Circle').filter((socket) => socket.name().startsWith('socket-'));
      const sideSockets = sockets.filter((socket) => side === 'left' ? socket.x() === 0 : socket.x() === cardWidth);
      const socket = sideSockets.find((candidate) => Math.abs(candidate.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Could not match ${side} socket to ${text.text()} label`);
      return socket;
    };
    const inputSocket = socketNear(inputText, 'left');
    const outputSocket = socketNear(outputText, 'right');
    const otherSocket = socketNear(otherText, 'right');
    const from = outputSocket.getAbsolutePosition(stage);
    const to = inputSocket.getAbsolutePosition(stage);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const paths: Array<{ id: string; curves: CurvePath[] }> = [];
    for (const wire of stage.find('.topology-wire')) {
      const curves: CurvePath[] = [];
      let current: CurvePath | undefined;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { current = undefined; },
        moveTo(x: number, y: number) { current = { start: { x, y }, strokeStyle: this.strokeStyle }; },
        bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
          if (current) {
            current.control1 = { x: c1x, y: c1y };
            current.control2 = { x: c2x, y: c2y };
            current.end = { x, y };
          }
        },
        lineTo() {}, closePath() {}, fill() {},
        stroke() { if (current?.control1 && current.control2 && current.end) curves.push({ ...current, strokeStyle: this.strokeStyle }); current = undefined; }
      };
      wire.getHitFunc().call(wire, { ...context, strokeShape(shape: NativeNode) { context.strokeStyle = shape.stroke(); context.stroke(); }, fillShape() { context.fill(); } }, wire);
      const geometry = [...new Map(curves.map((curve) => [`${curve.start.x},${curve.start.y}:${curve.end?.x},${curve.end?.y}`, curve])).values()];
      paths.push({ id: wire.id(), curves: geometry });
    }
    const match = paths.find(({ curves }) => curves.length === 3 && curves[0]?.start && curves.at(-1)?.end
      && distance(curves[0].start, from) < 0.1 && distance(curves.at(-1)!.end!, to) < 0.1);
    if (!match) throw new Error('No rendered self-loop joins Controller Self Call output to its matching input socket');
    const screenCurve = match.curves[1]!;
    const inverse = 0.5;
    const point = {
      x: inverse ** 3 * screenCurve.start.x + 3 * inverse ** 2 * inverse * screenCurve.control1!.x + 3 * inverse * inverse ** 2 * screenCurve.control2!.x + inverse ** 3 * screenCurve.end!.x,
      y: inverse ** 3 * screenCurve.start.y + 3 * inverse ** 2 * inverse * screenCurve.control1!.y + 3 * inverse * inverse ** 2 * screenCurve.control2!.y + inverse ** 3 * screenCurve.end!.y
    };
    const rect = (stage as NativeNode & { container(): HTMLElement }).container().getBoundingClientRect();
    const stageTransform = stage as NativeNode & { x(): number; y(): number; scaleX(): number; scaleY(): number };
    const localPosition = controller.getAbsolutePosition(stage);
    const accentTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-accent').trim() || '40 115 200';
    const actionTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-topology-action').trim() || '37 99 235';
    const actionStrongTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-topology-action-strong').trim() || '29 78 216';
    return {
      edgeId: match.id,
      groupPosition: localPosition,
      from,
      to,
      curves: match.curves.map((curve) => ({ ...curve, control1: curve.control1!, control2: curve.control2!, end: curve.end! })),
      screenMidpoint: { x: rect.left + stageTransform.x() + point.x * stageTransform.scaleX(), y: rect.top + stageTransform.y() + point.y * stageTransform.scaleY() },
      fromSocket: { fill: outputSocket.fill(), stroke: outputSocket.stroke() },
      toSocket: { fill: inputSocket.fill(), stroke: inputSocket.stroke() },
      otherSocket: { fill: otherSocket.fill(), stroke: otherSocket.stroke() },
      accent: `rgb(${accentTokens})`, action: `rgb(${actionTokens})`, actionStrong: `rgb(${actionStrongTokens})`
    };
  });
}

function apiPath(pathname: string): boolean {
  return pathname === '/REST' || pathname.startsWith('/REST/') || pathname.startsWith('/nodes/');
}

async function installGuard(
  page: Page,
  resolveApi: (route: Route, record: RequestRecord) => Promise<void>,
  options: { emptyDiscoveryNames?: readonly string[] } = {}
) {
  const requests: RequestRecord[] = [];
  const emptyDiscoveryNames = new Set(options.emptyDiscoveryNames ?? []);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`External request blocked: ${request.method()} ${url.origin}${url.pathname}`);
    }
    if (!apiPath(url.pathname)) {
      await route.continue();
      return;
    }
    // Legacy local fixtures model no advertised HTTP inventory unless they
    // opt into a specific inventory. Keep the newer discovery pass explicit.
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    const record = { method: request.method(), pathname: url.pathname, search: url.search };
    requests.push(record);
    if (request.method() !== 'GET') {
      if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') {
        const body = request.postDataJSON() as { name?: unknown };
        if (typeof body.name !== 'string' || !emptyDiscoveryNames.has(body.name)) {
          await route.abort('blockedbyclient');
          throw new Error(`Unfrozen discovery lookup blocked: ${String(body.name)}`);
        }
        await route.fulfill(jsonResponse([]));
        return;
      }
      await route.abort('blockedbyclient');
      throw new Error(`Non-GET local API request blocked: ${request.method()} ${url.pathname}`);
    }
    await resolveApi(route, record);
  });
  return requests;
}

function jsonResponse(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

type RemoteFixtureMode = 'allow' | 'deny' | 'redirect';

async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback fixture did not receive a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function startBuiltHttpsPreview() {
  const certificateDir = await mkdtemp(resolve(tmpdir(), 'konva-loopback-tls-'));
  const keyPath = resolve(certificateDir, 'key.pem');
  const certificatePath = resolve(certificateDir, 'certificate.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'
  ], { stdio: 'ignore' });
  const root = resolve('build/experiments/konva-canvas');
  const key = await readFile(keyPath);
  const cert = await readFile(certificatePath);
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
  };
  const server: HttpsServer = createHttpsServer({ key, cert }, (request, response) => {
    const pathname = new URL(request.url ?? '/', 'https://127.0.0.1').pathname;
    const file = resolve(root, `.${pathname === '/' ? '/topology-canvas.html' : pathname}`);
    const pathFromRoot = relative(root, file);
    if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') {
      response.writeHead(403).end();
      return;
    }
    void readFile(file).then((body) => {
      response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    }, () => response.writeHead(404).end());
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTPS preview did not receive a loopback port');
  return {
    origin: `https://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await rm(certificateDir, { recursive: true, force: true });
    }
  };
}

function waitGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolveGate) => { release = resolveGate; });
  return { promise, release };
}

function startRemoteHost(mode: RemoteFixtureMode, pageOrigin: string, responseOverrides: Partial<Record<'Alpha' | 'Beta', unknown>> = {}, holdResponses = true) {
  const requests: Array<{ method: string; pathname: string; origin?: string; cookie?: string }> = [];
  const arrivals = { Alpha: waitGate(), Beta: waitGate() };
  const started = { Alpha: waitGate(), Beta: waitGate() };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push({ method: request.method ?? '', pathname: url.pathname, ...(request.headers.origin ? { origin: request.headers.origin } : {}), ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}) });
    const owner = /^\/nodes\/(Alpha|Beta)\/REST\/remote$/.exec(url.pathname)?.[1] as 'Alpha' | 'Beta' | undefined;
    if (request.method !== 'GET' || !owner) {
      response.writeHead(404).end();
      return;
    }
    if (mode !== 'deny') {
      response.setHeader('Access-Control-Allow-Origin', pageOrigin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Timing-Allow-Origin', pageOrigin);
    }
    if (mode === 'redirect') {
      response.writeHead(302, { Location: '/redirect-target' }).end();
      return;
    }
    if (mode === 'allow' && owner in arrivals) {
      started[owner].release();
      const send = () => {
        const body = responseOverrides[owner] ?? (owner === 'Alpha'
          ? { actions: { 'Start Gamma': { node: 'Gamma', action: 'Activate' } } }
          : { events: { 'Gamma State': { node: 'Gamma', event: 'Changed' } } });
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(body));
      };
      if (holdResponses) void arrivals[owner].promise.then(send);
      else send();
      return;
    }
    const body = responseOverrides[owner] ?? (owner === 'Alpha'
      ? { actions: { 'Start Gamma': { node: 'Gamma', action: 'Activate' } } }
      : { events: { 'Gamma State': { node: 'Gamma', event: 'Changed' } } });
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  });
  return {
    server,
    requests,
    arrivals,
    started,
    listen: () => listenLoopback(server),
    close: () => closeServer(server)
  };
}

async function installExactEnrichmentFixture(page: Page, remoteOrigin: string, routeOrigins: readonly string[] = [remoteOrigin], ownerDelayMs = 0) {
  const requests: RequestRecord[] = [];
  const lookupNames: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (routeOrigins.includes(url.origin)) {
      await route.continue();
      return;
    }
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Out-of-fixture network request blocked: ${request.method()} ${url.origin}${url.pathname}`);
    }
    if (!apiPath(url.pathname)) {
      await route.continue();
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    const record = { method: request.method(), pathname: url.pathname, search: url.search };
    requests.push(record);
    if (url.pathname === '/REST' && request.method() === 'GET') {
      await route.fulfill(jsonResponse({ nodes: { Owner: {} } }));
    } else if (url.pathname === '/nodes/Owner/REST/remote' && request.method() === 'GET') {
      if (ownerDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, ownerDelayMs));
      await route.fulfill(jsonResponse({ actions: {
        'Call Alpha': { node: 'Alpha', action: 'Prepare' },
        'Call Beta': { node: 'Beta', action: 'Prepare' }
      } }));
    } else if (url.pathname === '/REST/nodeURLsForNode' && request.method() === 'POST') {
      const body = request.postDataJSON() as { name?: unknown };
      const name = body.name;
      if (name !== 'Alpha' && name !== 'Beta' && name !== 'Gamma') {
        throw new Error(`Discovery attempted for an unexpected exact-name owner: ${String(name)}`);
      }
      lookupNames.push(name);
      if (name === 'Gamma') {
        await route.fulfill(jsonResponse([]));
        return;
      }
      await route.fulfill(jsonResponse(routeOrigins.map((origin) => ({ node: name, address: `${origin}/nodes/${name}` }))));
    } else {
      await route.abort('blockedbyclient');
      throw new Error(`Unexpected local API request ${record.method} ${record.pathname}${record.search}`);
    }
  });
  return { requests, lookupNames };
}

// A status line can wrap as discovery finishes. Resizing must keep the same
// world point at the viewport midpoint, not the same top-left translation.
function centeredTranslation(before: { width: number; height: number }, after: { width: number; height: number }, x: number, y: number) {
  return { x: x + (after.width - before.width) / 2, y: y + (after.height - before.height) / 2 };
}

async function inspectKonvaScene(page: Page, saveBaseline = false) {
  return page.evaluate((shouldSave) => {
    type Point = { x: number; y: number };
    type NativeNode = {
      id(): string; name(): string; x(): number; y(): number; width(): number; height(): number;
      text(): string; stroke(): string; strokeWidth(): number; isDragging(): boolean;
      getClassName(): string; getAttrs(): Record<string, unknown>;
      getAbsolutePosition(top?: NativeNode): Point; find(selector: string): NativeNode[];
      getChildren?(): NativeNode[];
    };
    type Stage = NativeNode & {
      getContent(): HTMLElement; getChildren(): NativeNode[];
      x(): number; y(): number; scaleX(): number; scaleY(): number; width(): number; height(): number;
    };
    const state = window as Window & {
      Konva?: { stages?: Stage[] };
      __enrichmentRefs?: { stage: Stage; cards: Map<string, NativeNode>; sockets: Map<string, NativeNode>; wires: Map<string, NativeNode> };
      __shapeAttrs?: Map<string, { shape: NativeNode; attrs: string }>;
    };
    const stage = state.Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage registry is unavailable');
    const cardGroups = stage.find('.topology-card');
    const nameOf = (card: NativeNode) => card.find('Text').map((text) => text.text()).find((text) => ['Owner', 'Alpha', 'Beta', 'Gamma'].includes(text));
    const cards = new Map<string, NativeNode>();
    for (const card of cardGroups) {
      const name = nameOf(card);
      if (name) cards.set(name, card);
    }
    const sockets = new Map<string, NativeNode>();
    for (const [owner, card] of cards) {
      for (const socket of card.find('Circle').filter((circle) => circle.name().startsWith('socket-'))) {
        sockets.set(`${owner}:${socket.name()}`, socket);
      }
    }
    const wires = new Map(stage.find('.topology-wire').map((wire): [string, NativeNode] => [wire.id(), wire]));
    const attrs = new Map<string, { shape: NativeNode; attrs: string }>();
    const walk = (node: NativeNode, prefix: string) => {
      const children = node.getChildren?.() ?? [];
      children.forEach((child, index) => {
        const childPath = `${prefix}/${child.getClassName()}[${child.id() || child.name() || index}]`;
        if (!(child.getChildren?.() ?? []).length) {
          const safeAttrs = Object.fromEntries(Object.entries(child.getAttrs()).sort(([a], [b]) => a.localeCompare(b)));
          attrs.set(childPath, { shape: child, attrs: JSON.stringify(safeAttrs) });
        }
        walk(child, childPath);
      });
    };
    walk(stage, 'stage');
    if (shouldSave) {
      state.__enrichmentRefs = { stage, cards, sockets, wires };
      state.__shapeAttrs = attrs;
    }
    const rect = stage.getContent().getBoundingClientRect();
    return {
      camera: { x: stage.x(), y: stage.y(), scaleX: stage.scaleX(), scaleY: stage.scaleY() },
      viewport: { width: stage.width(), height: stage.height(), left: rect.left, top: rect.top },
      cardNames: [...cards.keys()].sort(),
      cardPositions: Object.fromEntries([...cards].map(([name, card]) => [name, card.getAbsolutePosition(stage)])),
      cardCount: cards.size,
      socketCount: sockets.size,
      wireCount: wires.size,
      shapeCount: attrs.size,
      dragging: Object.fromEntries([...cards].map(([name, card]) => [name, card.isDragging()])),
      selected: [...cards].filter(([, card]) => card.find('Rect')[0]?.strokeWidth() === 2.2).map(([name]) => name),
      ...(shouldSave ? {} : (() => {
        const baseline = state.__shapeAttrs;
        if (!baseline) throw new Error('Shape baseline was not captured');
        let touched = 0;
        let retained = 0;
        for (const [key, old] of baseline) {
          const current = attrs.get(key);
          if (current?.shape === old.shape) {
            retained += 1;
            if (current.attrs !== old.attrs) touched += 1;
          }
        }
        return { retainedShapes: retained, touchedShapes: touched, addedShapes: attrs.size - retained };
      })())
    };
  }, saveBaseline);
}

async function installKonvaDrawProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Owner = 'Alpha' | 'Beta';
    type Draw = { at: number; method: string };
    type Response = { at: number; url: string };
    type PatchPaint = { responseEndAt: number; visibleAt: number; method: string };
    type Probe = {
      firstDrawAt?: number;
      draws: Draw[];
      responses: Partial<Record<Owner, Response>>;
      patches: Partial<Record<Owner, PatchPaint>>;
      waitForPatch: (owner: Owner) => Promise<PatchPaint>;
    };
    const probe: Probe = { draws: [], responses: {}, patches: {}, waitForPatch: () => Promise.reject(new Error('invalid owner')) };
    const waiters = new Map<Owner, Array<(patch: PatchPaint) => void>>();
    probe.waitForPatch = (owner) => {
      const complete = probe.patches[owner];
      if (complete) return Promise.resolve(complete);
      return new Promise((resolvePatch) => {
        const pending = waiters.get(owner) ?? [];
        pending.push(resolvePatch);
        waiters.set(owner, pending);
      });
    };
    (window as Window & { __konvaDrawProbe?: Probe }).__konvaDrawProbe = probe;

    const assignVisibleDraws = () => {
      for (const owner of ['Alpha', 'Beta'] as const) {
        const response = probe.responses[owner];
        if (!response || probe.patches[owner]) continue;
        const draw = probe.draws.find((candidate) => candidate.at >= response.at);
        if (!draw) continue;
        const patch = { responseEndAt: response.at, visibleAt: draw.at, method: draw.method };
        probe.patches[owner] = patch;
        for (const resolvePatch of waiters.get(owner) ?? []) resolvePatch(patch);
        waiters.delete(owner);
      }
    };
    const captureResponses = () => {
      for (const entry of performance.getEntriesByType('resource')) {
        if (!(entry instanceof PerformanceResourceTiming) || entry.responseEnd <= 0) continue;
        const match = /\/nodes\/(Alpha|Beta)\/REST\/remote$/.exec(new URL(entry.name).pathname);
        if (!match) continue;
        const owner = match[1] as Owner;
        probe.responses[owner] ??= { at: entry.responseEnd, url: entry.name };
      }
      assignVisibleDraws();
    };
    const observer = new PerformanceObserver(captureResponses);
    observer.observe({ type: 'resource', buffered: true });

    const contextPrototype = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
    for (const method of ['fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage']) {
      const original = contextPrototype[method];
      if (typeof original !== 'function') continue;
      contextPrototype[method] = function(this: CanvasRenderingContext2D, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        if (this.canvas.closest('.canvas-stage')) {
          const draw = { at: performance.now(), method };
          probe.firstDrawAt ??= draw.at;
          probe.draws.push(draw);
          captureResponses();
          assignVisibleDraws();
        }
        return result;
      };
    }
  });
}

async function readCardPosition(page: Page, title: string): Promise<{ x: number; y: number }> {
  return page.evaluate((cardTitle) => {
    type Point = { x: number; y: number };
    type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top: Shape): Point };
    type Stage = Shape & { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === cardTitle));
    if (!stage || !card) throw new Error(`${cardTitle} card is missing`);
    return card.getAbsolutePosition(stage);
  }, title);
}

async function readCardDescription(page: Page, title: string): Promise<string> {
  return page.evaluate((cardTitle) => {
    type Shape = { text(): string; find(selector: string): Shape[]; getAttr(name: string): unknown };
    type Stage = Shape & { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === cardTitle));
    const description = card?.getAttr('accessibleDescription');
    if (typeof description !== 'string') throw new Error(`${cardTitle} accessible description is missing`);
    return description;
  }, title);
}

async function findWireHit(page: Page, endpointNames: [string, string]) {
  return page.evaluate((wantedNames) => {
    type Point = { x: number; y: number };
    type Curve = { start: Point; control1: Point; control2: Point; end: Point };
    type Shape = {
      id(): string; name(): string; text(): string; fill(): string; stroke(): string; getAttr(name: string): unknown;
      find(selector: string): Shape[]; getAbsolutePosition(top?: Shape): Point;
      getHitFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void;
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; strokeShape(shape: Shape): void; fillShape(shape: Shape): void;
        strokeStyle: string; fillStyle: string; lineWidth: number;
      }, shape: Shape) => void;
    };
    type Stage = Shape & {
      find(selector: string): Shape[]; getContent(): HTMLElement; getIntersection(point: Point): Shape | null;
      x(): number; y(): number; scaleX(): number; scaleY(): number;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable while locating selected wire');
    const sockets: Array<{ owner: string; shape: Shape; point: Point }> = [];
    for (const card of stage.find('.topology-card')) {
      const owner = card.find('Text').map((text) => text.text()).find((text) => ['Owner', 'Alpha', 'Beta', 'Gamma'].includes(text));
      if (!owner) continue;
      for (const socket of card.find('Circle').filter((circle) => circle.name().startsWith('socket-'))) {
        sockets.push({ owner, shape: socket, point: socket.getAbsolutePosition(stage) });
      }
    }
    const nearest = (point: Point) => sockets.reduce((best, candidate) => {
      const currentDistance = Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y);
      return currentDistance < best.distance ? { ...candidate, distance: currentDistance } : best;
    }, { owner: '', shape: null as Shape | null, point, distance: Number.POSITIVE_INFINITY });
    for (const wire of stage.find('.topology-wire')) {
      const curves: Curve[] = [];
      let current: Partial<Curve> | undefined;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { current = undefined; },
        moveTo(x: number, y: number) { current = { start: { x, y } }; },
        bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
          if (current?.start) { current.control1 = { x: x1, y: y1 }; current.control2 = { x: x2, y: y2 }; current.end = { x, y }; }
        },
        lineTo() {}, closePath() {}, fill() {},
        stroke() { if (current?.start && current.control1 && current.control2 && current.end) curves.push(current as Curve); current = undefined; }
      };
      wire.getHitFunc().call(wire, { ...context, strokeShape() { context.stroke(); }, fillShape() { context.fill(); } }, wire);
      if (curves.length === 0) continue;
      const first = nearest(curves[0]!.start);
      const last = nearest(curves.at(-1)!.end);
      if (!first.shape || !last.shape || first.distance > 1 || last.distance > 1) continue;
      if (![first.owner, last.owner].every((owner) => wantedNames.includes(owner)) || first.owner === last.owner) continue;
      const curve = curves[Math.floor(curves.length / 2)]!;
      for (const t of [0.5, 0.4, 0.6]) {
        const inverse = 1 - t;
        const point = {
          x: inverse ** 3 * curve.start.x + 3 * inverse ** 2 * t * curve.control1.x + 3 * inverse * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: inverse ** 3 * curve.start.y + 3 * inverse ** 2 * t * curve.control1.y + 3 * inverse * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        };
        const viewportPoint = { x: stage.x() + point.x * stage.scaleX(), y: stage.y() + point.y * stage.scaleY() };
        const hit = stage.getIntersection(viewportPoint);
        if (hit?.id() !== wire.id()) continue;
        const rect = stage.getContent().getBoundingClientRect();
        const actionTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-topology-action').trim() || '37 99 235';
        return {
          wireId: wire.id(),
          hitId: hit.id(),
          screen: { x: rect.left + viewportPoint.x, y: rect.top + viewportPoint.y },
        source: { owner: first.owner, socketId: first.shape.id(), fill: first.shape.fill(), stroke: first.shape.stroke(), connectionSelected: Boolean(first.shape.getAttr('connectionSelected')) },
        target: { owner: last.owner, socketId: last.shape.id(), fill: last.shape.fill(), stroke: last.shape.stroke(), connectionSelected: Boolean(last.shape.getAttr('connectionSelected')) },
        selectedStroke: `rgb(${actionTokens})`
        };
      }
    }
    throw new Error(`No rendered wire hit point found between ${wantedNames.join(' and ')} under current transform`);
  }, endpointNames);
}

async function findCanvasBackgroundDrag(page: Page, delta: { x: number; y: number }, steps: number) {
  return page.evaluate(({ delta, steps }) => {
    type Point = { x: number; y: number };
    type Stage = {
      getContent(): HTMLElement; width(): number; height(): number;
      getIntersection(point: Point): unknown;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable while locating background drag');
    const content = stage.getContent();
    const bounds = content.getBoundingClientRect();
    const toStage = ({ x, y }: Point) => ({
      x: (x - bounds.left) * stage.width() / bounds.width,
      y: (y - bounds.top) * stage.height() / bounds.height
    });
    const isCanvasBackground = (point: Point) => {
      const element = document.elementFromPoint(point.x, point.y);
      return element instanceof HTMLCanvasElement && element.parentElement === content && stage.getIntersection(toStage(point)) === null;
    };
    // Leave room for the full gesture in either direction and probe the same
    // screen positions Playwright will move through, not just a stage corner.
    const left = Math.ceil(Math.max(0, bounds.left) + 16 - Math.min(0, delta.x));
    const top = Math.ceil(Math.max(0, bounds.top) + 16 - Math.min(0, delta.y));
    const right = Math.min(innerWidth, bounds.right) - 16 - Math.max(0, delta.x);
    const bottom = Math.min(innerHeight, bounds.bottom) - 16 - Math.max(0, delta.y);
    for (let y = top; y <= bottom; y += 24) {
      for (let x = left; x <= right; x += 24) {
        const path = Array.from({ length: steps + 1 }, (_, i) => ({ x: x + delta.x * i / steps, y: y + delta.y * i / steps }));
        if (path.every(isCanvasBackground)) {
          return { from: { x, y }, to: { x: x + delta.x, y: y + delta.y }, stageBounds: bounds.toJSON() };
        }
      }
    }
    throw new Error(`No unobstructed canvas background for a ${delta.x}, ${delta.y} drag within ${JSON.stringify(bounds.toJSON())}`);
  }, { delta, steps });
}

async function waitForLocalCanvas(page: Page) {
  await expect(page.locator('[data-fixture-summary]')).toContainText('4 complete');
  await expect(page.locator('.canvas-failure')).toBeHidden();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
}

async function openLocalFixture(page: Page, requests: RequestRecord[]) {
  await page.goto('/topology-canvas.html?source=local');
  await waitForLocalCanvas(page);
  await expect.poll(() => requests.filter(({ pathname }) => pathname === '/REST/nodeURLsForNode').length).toBe(1);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    ...['Controller', 'IdleLocal', 'Scheduler', 'TouchPanel'].map((name) => ({ method: 'GET', pathname: `/nodes/${name}/REST/remote`, search: '' })),
    { method: 'POST', pathname: '/REST/nodeURLsForNode', search: '' }
  ]);
}

async function installLocalFixture(page: Page, options: { stalledOwners?: string[]; inventoryStatus?: number; emptyInventory?: boolean; inventory?: { nodes: Record<string, unknown> } } = {}) {
  const stalled = new Set(options.stalledOwners ?? []);
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(options.inventoryStatus
        ? jsonResponse({ denied: true }, options.inventoryStatus)
        : jsonResponse(options.inventory ?? (options.emptyInventory ? { nodes: {} } : localInventory)));
      return;
    }
    const owner = decodeURIComponent(request.pathname.split('/')[2] ?? '');
    if (stalled.has(owner)) return;
    const bindingOwner = ({ Controller: 'Controller', IdleLocal: 'Idle Local', Scheduler: 'Scheduler', TouchPanel: 'Touch Panel', CanonicalOwner: 'Canonical Owner' } as const)[owner as 'Controller' | 'IdleLocal' | 'Scheduler' | 'TouchPanel' | 'CanonicalOwner'];
    if (!bindingOwner || !Object.hasOwn(ownerBindings, bindingOwner)) {
      throw new Error(`Unexpected local fixture owner route ${request.pathname}`);
    }
    await route.fulfill(jsonResponse(ownerBindings[bindingOwner]));
  }, { emptyDiscoveryNames: ['Projector Left'] });
  return requests;
}

test('synthetic graph remains network-silent and unchanged', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    await route.abort('blockedbyclient');
    throw new Error(`Synthetic source attempted API access: ${request.method} ${request.pathname}`);
  });
  await page.goto('/topology-canvas.html?nodes=9');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.getByLabel('Graph source')).toHaveValue('9');
  expect(requests).toEqual([]);
  const syntheticTitles = await page.evaluate(() => {
    type Shape = { text(): string; listening(): boolean; name(): string; find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    return stage?.find('.topology-card').flatMap((card) => card.find('Text').filter((text) => text.name() === 'topology-node-title').map((text) => ({ title: text.text(), listening: text.listening(), name: text.name() }))) ?? [];
  });
  expect(syntheticTitles).toHaveLength(9);
  expect(syntheticTitles.every(({ listening, name }) => !listening && name !== 'topology-node-title-link')).toBe(true);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.locator('[data-topology-activity]')).toBeHidden();
});

test('opposing long endpoint labels stay disjoint through late rows, overflow resize, and inspection', async ({ page }) => {
  const beforeEnrichment = waitGate();
  const responseArrived = waitGate();
  const prefix = 'A very long shared endpoint name that differs only at its final character — ';
  const opposingLeft = `${prefix}A`;
  const opposingRight = `${prefix}B`;
  const actions = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const name = index === 0 ? opposingLeft : `Z additional lengthy action endpoint ${String(index).padStart(2, '0')}`;
    return [name, { node: 'Controller', action: name }];
  }));
  const events = { [opposingRight]: { node: 'Controller', event: opposingRight } };
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
      return;
    }
    if (request.pathname === '/nodes/Controller/REST/remote') {
      responseArrived.release();
      await beforeEnrichment.promise;
      await route.fulfill(jsonResponse({ actions, events }));
      return;
    }
    throw new Error(`Unexpected label fixture request ${request.method} ${request.pathname}`);
  }, { emptyDiscoveryNames: ['Controller'] });

  await page.goto('/topology-canvas.html?source=local');
  await responseArrived.promise;
  // Paint the pending owner before its request deadline; this fixture tests
  // a late row patch, not the automatic preview release timer.
  await page.getByRole('button', { name: 'Show now' }).click();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  const initial = await page.evaluate(() => {
    type Shape = { name(): string; find(selector: string): Shape[]; width(): number; height(): number; x(): number; y(): number; text(): string; align(): string; fill(): string; listening(): boolean };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    return { cardFound: Boolean(card), labels: card?.find('Text').filter(text => text.text().startsWith('A very long shared endpoint name') || text.text().startsWith('Z additional lengthy')).map(text => ({ x: text.x(), y: text.y(), width: text.width(), align: text.align(), text: text.text(), listening: text.listening() })) ?? [],
      cardHeight: card?.find('Rect').find(rect => rect.width() > 100)?.height() ?? 0, socketCount: card?.find('Circle').filter(circle => circle.name().startsWith('socket-')).length ?? 0,
      wireCount: stage?.find('.topology-wire').length ?? 0 };
  });
  expect(initial.cardFound).toBe(true);
  expect(initial.labels).toHaveLength(0);
  beforeEnrichment.release();
  await page.waitForFunction((name) => {
    type Shape = { find(selector: string): Shape[]; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    return stage?.find('.topology-card').some(card => card.find('Text').some(text => text.text() === name));
  }, opposingLeft);

  const enriched = await page.evaluate((names) => {
    type Shape = { name(): string; find(selector: string): Shape[]; width(): number; height(): number; x(): number; y(): number; text(): string; align(): string; fill(): string; listening(): boolean };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    if (!stage || !card) throw new Error('Controller card was not mounted');
    const label = (name: string) => card.find('Text').find(text => text.text() === name);
    const left = label(names.left);
    const right = label(names.right);
    if (!left || !right) throw new Error('Expected opposing long labels were not found');
    const bounds = card.find('Rect').find(rect => rect.width() > 100)!;
    return {
      left: { x: left.x(), y: left.y(), width: left.width(), align: left.align(), fill: left.fill(), text: left.text(), listening: left.listening() },
      right: { x: right.x(), y: right.y(), width: right.width(), align: right.align(), fill: right.fill(), text: right.text(), listening: right.listening() },
      card: { width: bounds.width(), height: bounds.height() },
      sockets: card.find('Circle').filter(circle => circle.name().startsWith('socket-')).map(socket => ({ x: socket.x(), y: socket.y() })),
      wires: stage.find('.topology-wire').map(wire => wire.name())
    };
  }, { left: opposingLeft, right: opposingRight });
  expect(enriched.left.y).toBe(enriched.right.y);
  expect(enriched.left.align).toBe('left');
  expect(enriched.right.align).toBe('right');
  expect(enriched.left.x + enriched.left.width).toBeLessThanOrEqual(enriched.right.x - 11.9);
  expect(enriched.left.listening).toBe(false);
  expect(enriched.right.listening).toBe(false);
  expect(enriched.left.text).toBe(opposingLeft);
  expect(enriched.right.text).toBe(opposingRight);
  expect(enriched.sockets).toHaveLength(4);
  expect(enriched.wires.length).toBeGreaterThan(0);

  await page.screenshot({ path: '/tmp/kilo/konva-opposing-labels-light.png', animations: 'disabled' });
  const clickPoint = await page.evaluate(() => {
    type Ref = { find(selector: string): Ref[]; text(): string; width(): number; getAbsolutePosition(top?: Ref): { x: number; y: number }; container(): HTMLElement; x(): number; y(): number; scaleX(): number; scaleY(): number };
    const stage = (window as Window & { Konva?: { stages?: Ref[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    if (!stage || !card) throw new Error('Controller card was not available for pointer selection');
    const position = card.getAbsolutePosition(stage);
    const cardWidth = card.find('Rect').find(rect => rect.width() > 100)!.width();
    const rect = stage.container().getBoundingClientRect();
    return { x: rect.left + stage.x() + (position.x + cardWidth / 2) * stage.scaleX(), y: rect.top + stage.y() + (position.y + 70) * stage.scaleY() };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  const portsButton = page.getByRole('button', { name: 'Ports and bindings' });
  await expect(portsButton).toBeVisible();
  const hoverPointFor = async (name: string) => page.evaluate((labelName) => {
    type Ref = { find(selector: string): Ref[]; text(): string; getAbsolutePosition(top?: Ref): { x: number; y: number }; container(): HTMLElement; x(): number; y(): number; scaleX(): number; scaleY(): number };
    const stage = (window as Window & { Konva?: { stages?: Ref[] } }).Konva?.stages?.[0];
    const label = stage?.find('.topology-card').flatMap(card => card.find('Text')).find(text => text.text() === labelName);
    if (!stage || !label) throw new Error('Long label was not available for pointer inspection');
    const position = label.getAbsolutePosition(stage);
    const rect = stage.container().getBoundingClientRect();
    return { x: rect.left + stage.x() + (position.x + 32) * stage.scaleX(), y: rect.top + stage.y() + (position.y + 7) * stage.scaleY() };
  }, name);
  const hoverRight = await hoverPointFor(opposingRight);
  await page.mouse.move(hoverRight.x, hoverRight.y);
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(opposingRight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const hoverLeft = await hoverPointFor(opposingLeft);
  await page.mouse.move(hoverLeft.x, hoverLeft.y);
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(opposingLeft.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  await portsButton.click();
  await page.getByRole('button', { name: 'Expand ports' }).click();
  const expandedHeight = await page.evaluate(() => {
    type Shape = { find(selector: string): Shape[]; width(): number; height(): number; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    return card?.find('Rect').find(rect => rect.width() > 100)?.height() ?? 0;
  });
  expect(expandedHeight).toBeGreaterThan(enriched.card.height);
  await page.getByRole('button', { name: 'Compact ports' }).click();
  const compacted = await page.evaluate((names) => {
    type Shape = { name(): string; find(selector: string): Shape[]; width(): number; height(): number; x(): number; y(): number; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    if (!stage || !card) throw new Error('Controller card disappeared');
    const labels = names.map(name => card.find('Text').find(text => text.text() === name));
    return { height: card.find('Rect').find(rect => rect.width() > 100)?.height() ?? 0, labels: labels.map(label => label && ({ x: label.x(), y: label.y(), width: label.width(), text: label.text() })),
      sockets: card.find('Circle').filter(circle => circle.name().startsWith('socket-')).map(socket => ({ x: socket.x(), y: socket.y() })), wires: stage.find('.topology-wire').length };
  }, [opposingLeft, opposingRight]);
  expect(compacted.height).toBe(enriched.card.height);
  expect(compacted.labels.every(Boolean)).toBe(true);
  expect(compacted.labels[0]).toMatchObject({ x: enriched.left.x, y: enriched.left.y, width: enriched.left.width, text: opposingLeft });
  expect(compacted.labels[1]).toMatchObject({ x: enriched.right.x, y: enriched.right.y, width: enriched.right.width, text: opposingRight });
  expect(compacted.sockets).toEqual(enriched.sockets);
  expect(compacted.wires).toBe(enriched.wires.length);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.selectOption('[data-theme-select]', 'dark');
  const darkLabelFill = await page.evaluate((name) => {
    type Shape = { find(selector: string): Shape[]; text(): string; fill(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const label = stage?.find('.topology-card').flatMap(card => card.find('Text')).find(text => text.text() === name);
    return label?.fill();
  }, opposingLeft);
  expect(darkLabelFill).toBeDefined();
  expect(darkLabelFill).not.toBe(enriched.left.fill);
  await page.screenshot({ path: '/tmp/kilo/konva-opposing-labels-dark.png', animations: 'disabled' });
  const reverseOrder = await page.evaluate(() => {
    type Shape = { find(selector: string): Shape[]; text(): string; y(): number; align(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    return card?.find('Text').filter(text => text.text().startsWith('A very long shared endpoint name') || text.text().startsWith('Z additional lengthy'))
      .sort((a, b) => a.y() - b.y() || (a.align() === 'left' ? -1 : 1)).map(text => text.text()) ?? [];
  });
  expect(reverseOrder.length).toBeGreaterThan(1);
  await page.locator('.canvas-stage').focus();
  await page.keyboard.press('[');
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(reverseOrder[reverseOrder.length - 1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.keyboard.press('[');
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(reverseOrder[reverseOrder.length - 2]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.keyboard.press(']');
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(reverseOrder[reverseOrder.length - 1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  expect(requests.some(({ method }) => method !== 'GET')).toBe(false);
});

test('pointer inspection survives card selection and a late opposite slot narrows its existing label', async ({ page }) => {
  const lateOwnerStarted = waitGate();
  const releaseLateOwner = waitGate();
  const prefix = 'Late opposite row endpoint with a shared long name — ';
  const leftLabel = `${prefix}A`;
  const rightLabel = `${prefix}B`;
  const controllerActions = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const alias = index === 0 ? rightLabel : `Z overflow binding ${String(index).padStart(2, '0')}`;
    return [alias, { node: 'Alpha', action: `Target ${index}` }];
  }));
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Controller: {}, Alpha: {} } }));
      return;
    }
    if (request.pathname === '/nodes/Alpha/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { [leftLabel]: { node: 'Controller', action: leftLabel } } }));
      return;
    }
    if (request.pathname === '/nodes/Controller/REST/remote') {
      lateOwnerStarted.release();
      await releaseLateOwner.promise;
      await route.fulfill(jsonResponse({ actions: controllerActions }));
      return;
    }
    throw new Error(`Unexpected late-slot fixture request ${request.method} ${request.pathname}`);
  });

  await page.goto('/topology-canvas.html?source=local');
  await lateOwnerStarted.promise;
  await page.getByRole('button', { name: 'Show now' }).click();
  await page.waitForFunction((name) => {
    type Shape = { find(selector: string): Shape[]; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    return stage?.find('.topology-card').some(card => card.find('Text').some(text => text.text() === name));
  }, leftLabel);

  const clickPoint = await page.evaluate(() => {
    type Ref = { find(selector: string): Ref[]; text(): string; width(): number; getAbsolutePosition(top?: Ref): { x: number; y: number }; container(): HTMLElement; x(): number; y(): number; scaleX(): number; scaleY(): number };
    const stage = (window as Window & { Konva?: { stages?: Ref[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    if (!stage || !card) throw new Error('Controller card was not available for selection');
    const position = card.getAbsolutePosition(stage);
    const cardWidth = card.find('Rect').find(rect => rect.width() > 100)!.width();
    const rect = stage.container().getBoundingClientRect();
    return { x: rect.left + stage.x() + (position.x + cardWidth / 2) * stage.scaleX(), y: rect.top + stage.y() + (position.y + 70) * stage.scaleY() };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  const selectedStrokeWidth = await page.evaluate(() => {
    type Shape = { find(selector: string): Shape[]; text(): string; width(): number; strokeWidth(): number };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    return card?.find('Rect').find(rect => rect.width() > 100)?.strokeWidth();
  });
  expect(selectedStrokeWidth).toBe(2.2);

  const labelPoint = async (name: string) => page.evaluate((labelName) => {
    type Ref = { find(selector: string): Ref[]; text(): string; getAbsolutePosition(top?: Ref): { x: number; y: number }; container(): HTMLElement; x(): number; y(): number; scaleX(): number; scaleY(): number };
    const stage = (window as Window & { Konva?: { stages?: Ref[] } }).Konva?.stages?.[0];
    const label = stage?.find('.topology-card').flatMap(card => card.find('Text')).find(text => text.text() === labelName);
    if (!stage || !label) throw new Error(`Port label ${labelName} is not mounted`);
    const position = label.getAbsolutePosition(stage);
    const rect = stage.container().getBoundingClientRect();
    return { x: rect.left + stage.x() + (position.x + 32) * stage.scaleX(), y: rect.top + stage.y() + (position.y + 7) * stage.scaleY() };
  }, name);
  const before = await page.evaluate((name) => {
    type Shape = { find(selector: string): Shape[]; name(): string; width(): number; height(): number; x(): number; y(): number; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    const label = card?.find('Text').find(text => text.text() === name);
    const rect = card?.find('Rect').find(shape => shape.width() > 100);
    if (!stage || !card || !label || !rect) throw new Error('Initial row geometry was unavailable');
    const socket = card.find('Circle').find(shape => shape.name().startsWith('socket-') && shape.x() === 0 && shape.y() === label.y() + 7);
    if (!socket) throw new Error('Initial visible socket is unavailable');
    return { label: { x: label.x(), y: label.y(), width: label.width() }, card: { width: rect.width(), height: rect.height() }, socket: { x: socket.x(), y: socket.y() }, wires: stage.find('.topology-wire').length };
  }, leftLabel);
  const beforePointer = await page.evaluate((name) => {
    type Ref = { find(selector: string): Ref[]; text(): string; x(): number; y(): number; width(): number; getAbsolutePosition(top?: Ref): { x: number; y: number }; container(): HTMLElement; scaleX(): number; scaleY(): number };
    const stage = (window as Window & { Konva?: { stages?: Ref[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    const label = card?.find('Text').find(text => text.text() === name);
    const rect = card?.find('Rect').find(shape => shape.width() > 100);
    if (!stage || !card || !label || !rect) throw new Error('Initial label pointer target was unavailable');
    const position = card.getAbsolutePosition(stage);
    const canvas = stage.container().getBoundingClientRect();
    return { x: canvas.left + stage.x() + (position.x + rect.width() * 0.75) * stage.scaleX(), y: canvas.top + stage.y() + (position.y + label.y() + 7) * stage.scaleY() };
  }, leftLabel);
  await page.mouse.move(beforePointer.x, beforePointer.y);
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(leftLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  releaseLateOwner.release();
  await page.waitForFunction((name) => {
    type Shape = { find(selector: string): Shape[]; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    return stage?.find('.topology-card').some(card => card.find('Text').some(text => text.text() === name));
  }, rightLabel);
  // No pointer movement after release: row geometry patch must re-hit-test the stationary pointer.
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(rightLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const after = await page.evaluate((names) => {
    type Shape = { find(selector: string): Shape[]; name(): string; width(): number; height(): number; x(): number; y(): number; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(candidate => candidate.find('Text').some(text => text.text() === 'Controller'));
    const left = card?.find('Text').find(text => text.text() === names.left);
    const right = card?.find('Text').find(text => text.text() === names.right);
    const rect = card?.find('Rect').find(shape => shape.width() > 100);
    if (!stage || !card || !left || !right || !rect) throw new Error('Late opposite row geometry was unavailable');
    const socket = card.find('Circle').find(shape => shape.name().startsWith('socket-') && shape.x() === 0 && shape.y() === left.y() + 7);
    if (!socket) throw new Error('Existing visible socket disappeared');
    return { left: { x: left.x(), y: left.y(), width: left.width() }, right: { x: right.x(), y: right.y(), width: right.width() },
      card: { width: rect.width(), height: rect.height() }, socket: { x: socket.x(), y: socket.y() }, wires: stage.find('.topology-wire').length };
  }, { left: leftLabel, right: rightLabel });
  expect(after.left.x).toBe(before.label.x);
  expect(after.left.y).toBe(before.label.y);
  expect(after.left.width).toBeLessThan(before.label.width);
  expect(after.left.x + after.left.width).toBeLessThanOrEqual(after.right.x - 11.9);
  expect(after.right.y).toBe(after.left.y);
  expect(after.card).toEqual(before.card);
  expect(after.socket).toEqual(before.socket);
  expect(after.wires).toBeGreaterThan(before.wires);

  for (const name of [rightLabel, leftLabel]) {
    const point = await labelPoint(name);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  expect(requests.some(({ pathname }) => pathname === '/nodes/Alpha/REST/remote')).toBe(true);
  expect(requests.some(({ pathname }) => pathname === '/nodes/Controller/REST/remote')).toBe(true);
});

test('local preview paints a connected group before held HTTP inventory and preserves gestures on release', async ({ page }) => {
  const records: RequestRecord[] = [];
  const advertisement = waitGate();
  const inventoryGate = waitGate();
  const inventoryRequested = waitGate();
  let advertisementArrivals = 0;
  await page.addInitScript(() => {
    type Ref = { id(): string; name(): string; text(): string; find(selector: string): Ref[]; getAbsolutePosition(top?: Ref): { x: number; y: number }; isDragging(): boolean };
    (window as Window & { __topologyPreviewRefs?: { stage: Ref; cards: Map<string, Ref>; wires: Map<string, Ref> } }).__topologyPreviewRefs = undefined;
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Preview fixture blocked external request ${request.method()} ${url.origin}${url.pathname}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    records.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (url.pathname === '/REST' && request.method() === 'GET') {
      inventoryRequested.release();
      await inventoryGate.promise;
      await route.fulfill(jsonResponse({ nodes: { Controller: {}, Scheduler: {} } }));
    } else if (url.pathname === '/REST/nodeURLs' && request.method() === 'POST') {
      advertisementArrivals += 1;
      await advertisement.promise;
      await route.fulfill(jsonResponse([]));
    } else if (url.pathname === '/nodes/Controller/REST/remote' && request.method() === 'GET') {
      await route.fulfill(jsonResponse({ actions: { 'Run Scheduler': { node: 'Scheduler', action: 'Run' } } }));
    } else if (url.pathname === '/nodes/Scheduler/REST/remote' && request.method() === 'GET') {
      await route.fulfill(jsonResponse({ events: { 'Controller Ready': { node: 'Controller', event: 'Ready' } } }));
    } else {
      await route.abort('blockedbyclient');
      throw new Error(`Unexpected preview fixture request ${request.method()} ${url.pathname}`);
    }
  });

  const navigationStarted = Date.now();
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'commit' });
  await inventoryRequested.promise;
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  await expect(page.locator('[data-topology-show-now]')).toHaveJSProperty('hidden', await page.evaluate(() => window.topologyStartupShell!.released));
  await expect(page.locator('[data-topology-status]')).toHaveAttribute('role', 'status');
  inventoryGate.release();
  await expect.poll(() => advertisementArrivals).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    type Shape = { id(): string; name(): string; text(): string; find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
    return Boolean(stage && stage.find('.topology-wire').length === 2 && stage.find('.topology-card').some((card) => card.find('Text').some((text) => text.text() === 'Controller')));
  })).toBe(true);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show now' })).toBeHidden();
  await expect(page.locator('[data-topology-activity]')).toBeVisible();
  expect(Date.now() - navigationStarted).toBeLessThan(3_000);
  expect(records.filter(({ method, pathname }) => method === 'POST' && pathname === '/REST/nodeURLs')).toHaveLength(1);
  expect(records.filter(({ method, pathname }) => method === 'GET' && pathname === '/REST')).toHaveLength(1);

  const initial = await page.evaluate(() => {
    type Shape = { id(): string; name(): string; text(): string; x(): number; y(): number; find(selector: string): Shape[]; getAbsolutePosition(top?: Shape): { x: number; y: number } };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; getContent(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva preview stage was not mounted');
    const cards = stage.find('.topology-card');
    const byTitle = (title: string) => cards.find((card) => card.find('Text').some((text) => text.text() === title));
    const controller = byTitle('Controller');
    const scheduler = byTitle('Scheduler');
    if (!controller || !scheduler) throw new Error('Connected local owners were not both mounted');
    const rect = stage.getContent().getBoundingClientRect();
    const pos = controller.getAbsolutePosition(stage);
    const wireIds = stage.find('.topology-wire').map((wire) => wire.id());
    (window as Window & { __topologyPreviewRefs?: { stage: Shape; cards: Map<string, Shape>; wires: Map<string, Shape> } }).__topologyPreviewRefs = {
      stage, cards: new Map([['Controller', controller], ['Scheduler', scheduler]]),
      wires: new Map(stage.find('.topology-wire').map((wire) => [wire.id(), wire]))
    };
    return {
      wireIds,
      drag: { x: rect.left + stage.x() + (pos.x + 60) * stage.scaleX(), y: rect.top + stage.y() + (pos.y + 45) * stage.scaleY() },
      camera: [stage.x(), stage.y(), stage.scaleX()]
    };
  });
  expect(initial.wireIds.length).toBeGreaterThan(0);
  const beforePosition = await readCardPosition(page, 'Controller');
  await page.mouse.move(initial.drag.x, initial.drag.y);
  await page.mouse.down();
  await page.mouse.move(initial.drag.x + 38, initial.drag.y + 24, { steps: 4 });
  await page.mouse.up();
  const afterPosition = await readCardPosition(page, 'Controller');
  expect(afterPosition).not.toEqual(beforePosition);
  const zoomPoint = await page.locator('.canvas-stage').boundingBox();
  if (!zoomPoint) throw new Error('Canvas stage bounds unavailable during held inventory');
  await page.mouse.move(zoomPoint.x + 20, zoomPoint.y + 20);
  await page.mouse.wheel(0, -240);
  const readPreviewScene = () => page.evaluate(() => {
    type Shape = { id(): string; text(): string; find(selector: string): Shape[]; x(): number; y(): number };
    type Stage = Shape & { width(): number; height(): number; scaleX(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Stage disappeared while inventory was held');
    const card = stage.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === 'Controller'));
    return { viewport: { width: stage.width(), height: stage.height() }, camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() }, wireIds: stage.find('.topology-wire').map((wire) => wire.id()), position: [card?.x(), card?.y()] };
  });
  const heldScene = await readPreviewScene();
  await mkdir(artifactDir, { recursive: true });
  const image = await page.screenshot({ path: resolve(artifactDir, 'preview-connected-before-advertisement-release.png'), animations: 'disabled' });
  await test.info().attach('preview-connected-before-advertisement-release.png', { body: image, contentType: 'image/png' });

  advertisement.release();
  await expect(page.locator('[data-topology-activity]')).toBeHidden();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  const finalScene = await readPreviewScene();
  expect(advertisementArrivals).toBe(1);
  expect(records.filter(({ method, pathname }) => method === 'POST' && pathname === '/REST/nodeURLs')).toHaveLength(1);
  expect(finalScene.wireIds).toEqual(heldScene.wireIds);
  expect(finalScene.position).toEqual(heldScene.position);
  expect(finalScene.camera).toEqual({ ...heldScene.camera, ...centeredTranslation(heldScene.viewport, finalScene.viewport, heldScene.camera.x, heldScene.camera.y) });
  expect(await readCardPosition(page, 'Controller')).toEqual(afterPosition);
  const retainedObjects = await page.evaluate(() => {
    type Shape = { id(): string; text(): string; find(selector: string): Shape[] };
    type Stage = Shape & { find(selector: string): Shape[] };
    const state = window as Window & { Konva?: { stages?: Stage[] }; __topologyPreviewRefs?: { stage: Stage; cards: Map<string, Shape>; wires: Map<string, Shape> } };
    const stage = state.Konva?.stages?.[0];
    const baseline = state.__topologyPreviewRefs;
    if (!stage || !baseline) throw new Error('Preview object baseline is unavailable');
    const cards = new Map(stage.find('.topology-card').map((card): [string, Shape] => [
      card.find('Text').map((text) => text.text()).find((name) => name === 'Controller' || name === 'Scheduler') ?? '', card
    ]));
    const wires = new Map(stage.find('.topology-wire').map((wire): [string, Shape] => [wire.id(), wire]));
    return {
      stage: stage === baseline.stage,
      cards: [...baseline.cards].every(([name, card]) => cards.get(name) === card),
      wires: [...baseline.wires].every(([id, wire]) => wires.get(id) === wire)
    };
  });
  expect(retainedObjects).toEqual({ stage: true, cards: true, wires: true });
});

test('first camera frames a readable local pair despite a much larger disconnected inventory', async ({ page }) => {
  const isolatedNames = Array.from({ length: 64 }, (_, index) => `Z Spare ${index}`);
  const bulk = waitGate();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({
      nodes: Object.fromEntries(['Controller', 'Scheduler', ...isolatedNames].map((name) => [name, {}]))
    }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      await bulk.promise;
      return route.fulfill(jsonResponse([]));
    }
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') {
      return route.fulfill(jsonResponse({ actions: { Run: { node: 'Scheduler', action: 'Run' } } }));
    }
    if (request.method() === 'GET' && /^\/nodes\/[^/]+\/REST\/remote$/.test(url.pathname)) return route.fulfill(jsonResponse({}));
    return route.abort('blockedbyclient');
  });
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  const camera = await page.evaluate(() => {
    type Shape = { text(): string; find(selector: string): Shape[]; getClientRect(): { x: number; y: number; width: number; height: number } };
    type Stage = Shape & { scaleX(): number; width(): number; height(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Missing initial stage');
    const cards = stage.find('.topology-card');
    const group = cards.filter((card) => card.find('Text').some((shape) => /^(Controller|Scheduler)$/.test(shape.text())));
    return { count: cards.length, zoom: stage.scaleX(), width: stage.width(), height: stage.height(),
      group: group.map((card) => card.getClientRect()), wire: stage.find('.topology-wire').length };
  });
  bulk.release();
  expect(camera.count).toBeGreaterThan(40);
  expect(camera.group).toHaveLength(2);
  expect(camera.wire).toBe(1);
  expect(camera.zoom).toBeGreaterThanOrEqual(0.35);
  for (const rect of camera.group) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(camera.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(camera.height);
  }
});

test('a configured event owner is looked up while bulk discovery is held, without a duplicate owner read', async ({ page }) => {
  const bulk = waitGate();
  const exact = waitGate();
  const requests: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    requests.push(`${request.method()} ${url.pathname}`);
    const advertisement = { node: 'Publisher', address: `${experimentOrigin}/nodes/Publisher/` };
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Subscriber: {} } }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      await bulk.promise;
      return route.fulfill(jsonResponse([advertisement]));
    }
    if (request.method() === 'GET' && url.pathname === '/nodes/Subscriber/REST/remote') {
      return route.fulfill(jsonResponse({ events: { Ready: { node: 'Publisher', event: 'Ready' } } }));
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') {
      expect(request.postDataJSON()).toEqual({ name: 'Publisher' });
      const result = await route.fulfill(jsonResponse([advertisement]));
      exact.release();
      return result;
    }
    if (request.method() === 'GET' && url.pathname === '/nodes/Publisher/REST/remote') return route.fulfill(jsonResponse({}));
    return route.abort('blockedbyclient');
  });
  await page.goto('/topology-canvas.html?source=local');
  await exact.promise;
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  expect(requests).not.toContain('GET /nodes/Publisher/REST/remote');
  bulk.release();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  expect(requests.filter((request) => request === 'POST /REST/nodeURLsForNode')).toHaveLength(1);
  expect(requests.filter((request) => request === 'GET /nodes/Publisher/REST/remote')).toHaveLength(1);
});

test('native shell latches keyboard Show now before delayed renderer import', async ({ page }) => {
  const entryGate = waitGate();
  const moduleGate = waitGate();
  const moduleRequested = waitGate();
  const inventoryGate = waitGate();
  const inventoryRequested = waitGate();
  const requests: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (/\/assets\/topology-canvas-[^/]+\.js$/.test(url.pathname)) { await entryGate.promise; return route.continue(); }
    if (/\/assets\/main-[^/]+\.js$/.test(url.pathname)) {
      moduleRequested.release();
      await moduleGate.promise;
      return route.continue();
    }
    if (!apiPath(url.pathname)) return route.continue();
    requests.push(`${request.method()} ${url.pathname}`);
    if (request.method() === 'GET' && url.pathname === '/REST') {
      inventoryRequested.release();
      await inventoryGate.promise;
      return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    }
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') return route.fulfill(jsonResponse({}));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected delayed-renderer API request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'commit' });
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  const showNow = page.locator('[data-topology-show-now]');
  await expect(showNow).toBeVisible();
  await showNow.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as Window & { __topologyShowNowRequested?: boolean }).__topologyShowNowRequested)).toBe(true);
  entryGate.release();
  await moduleRequested.promise;
  await inventoryRequested.promise;
  await expect.poll(() => requests).toEqual(['GET /REST', 'POST /REST/nodeURLs']);
  // The UI shell is native HTML and remains available while the renderer module is held.
  await expect(page.locator('.canvas-stage')).toHaveCount(0);
  moduleGate.release();
  await inventoryRequested.promise;
  await expect(page.locator('[data-topology-status]')).toHaveText('Waiting for node data…');
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show now' })).toBeHidden();
  inventoryGate.release();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.locator('[data-topology-status]')).toHaveText('Waiting for node data…');
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  expect(requests).toEqual(['GET /REST', 'POST /REST/nodeURLs', 'GET /nodes/Controller/REST/remote']);
});

test('deadline releases before inventory data and first later evidence paints without a second wait', async ({ page }) => {
  const inventoryGate = waitGate();
  const inventoryRequested = waitGate();
  const moduleGate = waitGate();
  const moduleRequested = waitGate();
  await page.addInitScript(() => {
    window.addEventListener('topology-preview-release', (event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      (window as Window & { __topologyRelease?: { reason?: string; at: number } }).__topologyRelease = { reason: detail?.reason, at: performance.now() };
    });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    // Hold the independent discovery chunk briefly so the navigation deadline
    // definitely precedes either request timeout, without coupling it to Konva.
    if (/\/assets\/preview-coordinator-[^/]+\.js$/.test(url.pathname)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1_650));
      return route.continue();
    }
    if (/\/assets\/main-[^/]+\.js$/.test(url.pathname)) {
      moduleRequested.release();
      await moduleGate.promise;
      return route.continue();
    }
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/REST') {
      inventoryRequested.release();
      await inventoryGate.promise;
      return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') return route.fulfill(jsonResponse({}));
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected deadline fixture request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'commit' });
  await moduleRequested.promise;
  await inventoryRequested.promise;
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  await page.waitForFunction(() => window.topologyStartupShell?.releaseReason === 'deadline');
  const waitingAt = await page.evaluate(() => performance.now());
  await expect(page.locator('[data-topology-status]')).toHaveText('Waiting for node data…');
  await expect(page.getByRole('button', { name: 'Show now' })).toBeHidden();
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  inventoryGate.release();
  moduleGate.release();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  const elapsedAfterDeadline = await page.evaluate((start) => performance.now() - start, waitingAt);
  expect(elapsedAfterDeadline).toBeLessThan(1_000);
  const release = await page.evaluate(() => (window as Window & { __topologyRelease?: { reason?: string; at: number } }).__topologyRelease);
  expect(release?.reason).toBe('deadline');
  expect(release?.at).toBeGreaterThan(0);
});

test('a rejected renderer chunk reports an accessible error after discovery starts', async ({ page }) => {
  const discovery = waitGate();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (/\/assets\/main-[^/]+\.js$/.test(url.pathname)) {
      await discovery.promise;
      return route.abort('failed');
    }
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: {} }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      discovery.release();
      return route.fulfill(jsonResponse([]));
    }
    if (apiPath(url.pathname)) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-failure')).toHaveText('Local topology canvas could not be rendered.');
  await expect(page.locator('.canvas-failure')).toBeVisible();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show now' })).toBeHidden();
});

test('startup scrim remains until a populated layer has actually painted in dark reduced-motion mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    (window as Window & { __holdTopologyCanvasPaint?: boolean }).__holdTopologyCanvasPaint = true;
    const prototype = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
    for (const method of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']) {
      const original = prototype[method];
      if (typeof original !== 'function') continue;
      const draw = original as (this: CanvasRenderingContext2D, ...args: unknown[]) => void;
      prototype[method] = function(this: CanvasRenderingContext2D, ...args: unknown[]) {
        if ((window as Window & { __holdTopologyCanvasPaint?: boolean }).__holdTopologyCanvasPaint && this.canvas.closest('.canvas-stage')) return;
        draw.apply(this, args);
      };
    }
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') return route.fulfill(jsonResponse({}));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected paint-gate API request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { Konva?: { stages?: unknown[] } }).Konva?.stages?.length))).toBe(true);
  const beforePaint = await page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas')].map((canvas) => {
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return -1;
    let ink = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) ink += 1;
    return ink;
  }));
  expect(beforePaint).toHaveLength(2);
  expect(beforePaint.every((ink) => ink === 0)).toBe(true);
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  const reducedMotionStyle = await page.locator('.topology-startup-bar').evaluate((element) => getComputedStyle(element, '::after').animationName);
  expect(reducedMotionStyle).toBe('none');
  const buttonStyle = await page.locator('[data-topology-show-now]').evaluate((element) => ({ opacity: getComputedStyle(element).opacity, color: getComputedStyle(element).color }));
  expect(buttonStyle.opacity).toBe('1');
  expect(buttonStyle.color).not.toBe('rgba(0, 0, 0, 0)');

  await page.evaluate(() => {
    (window as Window & { __holdTopologyCanvasPaint?: boolean }).__holdTopologyCanvasPaint = false;
    const stage = (window as Window & { Konva?: { stages?: Array<{ draw(): void }> } }).Konva?.stages?.[0];
    stage?.draw();
  });
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  const afterPaint = await page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas')].map((canvas) => {
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return 0;
    let ink = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) ink += 1;
    return ink;
  }));
  expect(afterPaint.some((ink) => ink > 0)).toBe(true);
});

test('dark reduced-motion shell keeps the startup action visible and high-contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const inventoryGate = waitGate();
  const inventoryRequested = waitGate();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/REST') {
      inventoryRequested.release();
      await inventoryGate.promise;
      return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') return route.fulfill(jsonResponse({}));
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected reduced-motion fixture request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local');
  await inventoryRequested.promise;
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  const motion = await page.locator('.topology-startup-bar').evaluate((element) => getComputedStyle(element, '::after').animationName);
  expect(motion).toBe('none');
  const buttonStyle = await page.locator('[data-topology-show-now]').evaluate((element) => ({ opacity: getComputedStyle(element).opacity, color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(buttonStyle.opacity).toBe('1');
  expect(buttonStyle.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(buttonStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  inventoryGate.release();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
});

test('Arrange by connections treats a physically dragged card as a fixed anchor', async ({ page }) => {
  const requests: RequestRecord[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {}, Scheduler: {} } }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') return route.fulfill(jsonResponse({ actions: { 'Run Scheduler': { node: 'Scheduler', action: 'Run' } } }));
    if (request.method() === 'GET' && url.pathname === '/nodes/Scheduler/REST/remote') return route.fulfill(jsonResponse({ events: { 'Controller Ready': { node: 'Controller', event: 'Ready' } } }));
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected Arrange fixture request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  const arrange = page.getByRole('button', { name: 'Arrange by connections' });
  await expect(arrange).toBeVisible();
  const before = await page.evaluate(() => {
    type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top?: Shape): { x: number; y: number }; width(): number; height(): number };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; getContent(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Stage unavailable before Arrange');
    const card = stage.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === 'Controller'));
    if (!card) throw new Error('Controller card missing before Arrange');
    const position = card.getAbsolutePosition(stage);
    const bounds = stage.getContent().getBoundingClientRect();
    return { point: { x: bounds.left + stage.x() + (position.x + 70) * stage.scaleX(), y: bounds.top + stage.y() + (position.y + 48) * stage.scaleY() }, camera: [stage.x(), stage.y(), stage.scaleX()] };
  });
  await page.mouse.move(before.point.x, before.point.y);
  await page.mouse.down();
  await page.mouse.move(before.point.x + 120, before.point.y + 55, { steps: 5 });
  await page.mouse.up();
  const pinned = await readCardPosition(page, 'Controller');
  const afterDrag = await inspectKonvaScene(page, true);
  await arrange.click();
  const afterArrange = await inspectKonvaScene(page);
  expect(await readCardPosition(page, 'Controller')).toEqual(pinned);
  expect(afterArrange.camera).toEqual(afterDrag.camera);
  expect(afterArrange.selected).toEqual(afterDrag.selected);
  expect(requests.filter(({ method, pathname }) => method === 'POST' && pathname === '/REST/nodeURLs')).toHaveLength(1);
});

test('Show all discovered overrides only name deferral and does not rerun the preview release', async ({ page }) => {
  const names = Array.from({ length: 42 }, (_, index) => `Member${String(index).padStart(2, '0')}`);
  let remoteGets = 0;
  const remote = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const name = /^\/nodes\/(Member\d{2})\/REST\/remote$/.exec(pathname)?.[1];
    if (request.method !== 'GET' || !name) { response.writeHead(404).end(); return; }
    remoteGets += 1;
    response.setHeader('Access-Control-Allow-Origin', experimentOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.writeHead(200).end('{}');
  });
  const remoteOrigin = await listenLoopback(remote);
  const localRequests: RequestRecord[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === remoteOrigin) return route.continue();
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Show-all fixture blocked unplanned origin ${url.origin}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    localRequests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Owner: {} } }));
    if (request.method() === 'GET' && url.pathname === '/nodes/Owner/REST/remote') return route.fulfill(jsonResponse({ actions: { 'Call first member': { node: 'Member00', action: 'Wake' } } }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse(names.map((node) => ({ node, address: `${remoteOrigin}/nodes/${node}` }))));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') {
      const name = (request.postDataJSON() as { name?: unknown }).name;
      if (name !== 'Member00') throw new Error(`Show-all fixture performed unexpected exact lookup ${String(name)}`);
      return route.fulfill(jsonResponse([{ node: 'Member00', address: `${remoteOrigin}/nodes/Member00` }]));
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected Show-all request ${request.method()} ${url.pathname}`);
  });
  try {
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    const showAll = page.getByRole('button', { name: 'Show all discovered' });
    await expect(showAll).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show now' })).toBeHidden();
    const before = await page.evaluate(() => {
      type Shape = { find(selector: string): Shape[]; text(): string; id(): string };
      const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Show-all preview stage unavailable');
      const names = stage.find('.topology-card').map((card) => card.find('Text').map((text) => text.text()).find(Boolean)).filter(Boolean);
      return { names, wires: stage.find('.topology-wire').map((wire) => wire.id()) };
    });
    expect(before.names.length).toBeLessThan(names.length + 1);
    expect(before.names).toContain('Owner');
    await showAll.click();
    await expect.poll(() => page.evaluate(() => {
      type Shape = { find(selector: string): Shape[]; text(): string };
      const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
      return stage?.find('.topology-card').flatMap((card) => card.find('Text').map((text) => text.text())).filter((text) => /^Member\d{2}$/.test(text)).length ?? 0;
    })).toBe(names.length);
    const after = await page.evaluate(() => {
      type Shape = { find(selector: string): Shape[]; text(): string; id(): string };
      const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Show-all stage unavailable after reveal');
      const cards = stage.find('.topology-card');
      return { cardCount: cards.length, names: cards.flatMap((card) => card.find('Text').map((text) => text.text()).filter((text) => /^Member\d{2}$/.test(text))).sort() };
    });
    expect(after.cardCount).toBe(names.length + 1);
    expect(after.names).toEqual(names);
    await expect(page.getByRole('button', { name: 'Show all discovered' })).toBeHidden();
    await page.getByRole('button', { name: 'Reset view' }).click();
    expect(localRequests.filter(({ method, pathname }) => method === 'POST' && pathname === '/REST/nodeURLs')).toHaveLength(1);
    expect(remoteGets).toBeLessThan(names.length);
    await mkdir(artifactDir, { recursive: true });
    const image = await page.screenshot({ path: resolve(artifactDir, 'show-all-discovered-preview.png'), animations: 'disabled' });
    await test.info().attach('show-all-discovered-preview.png', { body: image, contentType: 'image/png' });
  } finally {
    await closeServer(remote);
  }
});

test('painted local map returns from BFCache with the same scene, camera, and no repeated requests', async ({ page }) => {
  const requests: RequestRecord[] = [];
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) => {
      (window as Window & { __topologyBfCacheReturn?: boolean }).__topologyBfCacheReturn = event.persisted;
    });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {}, Scheduler: {} } }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (request.method() === 'GET' && url.pathname === '/nodes/Controller/REST/remote') return route.fulfill(jsonResponse({ actions: { 'Run Scheduler': { node: 'Scheduler', action: 'Run' } } }));
    if (request.method() === 'GET' && url.pathname === '/nodes/Scheduler/REST/remote') return route.fulfill(jsonResponse({ events: { 'Controller Ready': { node: 'Controller', event: 'Ready' } } }));
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected retained-map fixture request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  const viewport = await page.locator('.canvas-stage').boundingBox();
  if (!viewport) throw new Error('Retained topology stage bounds unavailable');
  await page.mouse.move(viewport.x + 30, viewport.y + 30);
  await page.mouse.wheel(0, -220);
  await page.mouse.move(viewport.x + 20, viewport.y + 20);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 62, viewport.y + 48, { steps: 4 });
  await page.mouse.up();
  const before = await page.evaluate(() => {
    type Shape = { id(): string; text(): string; find(selector: string): Shape[]; x(): number; y(): number };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number };
    const state = window as Window & { Konva?: { stages?: Stage[] }; __topologyRetainedBaseline?: { stage: Stage; cards: Map<string, Shape>; wires: Map<string, Shape>; camera: number[] } };
    const stage = state.Konva?.stages?.[0];
    if (!stage) throw new Error('Painted local stage unavailable before BFCache navigation');
    const cards = new Map(stage.find('.topology-card').map((card): [string, Shape] => [
      card.find('Text').map((text) => text.text()).find((name) => name === 'Controller' || name === 'Scheduler') ?? '', card
    ]));
    const wires = new Map(stage.find('.topology-wire').map((wire): [string, Shape] => [wire.id(), wire]));
    const camera = [stage.x(), stage.y(), stage.scaleX(), stage.scaleY()];
    state.__topologyRetainedBaseline = { stage, cards, wires, camera };
    return { camera, cardCount: cards.size, wireCount: wires.size };
  });
  expect(before.cardCount).toBe(2);
  expect(before.wireCount).toBeGreaterThan(0);
  expect(before.camera[2]).not.toBe(1);
  const requestCount = requests.length;
  await page.goto('/topology-canvas.html?nodes=9');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => (window as Window & { __topologyBfCacheReturn?: boolean }).__topologyBfCacheReturn)).toBe(true);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  const after = await page.evaluate(() => {
    type Shape = { id(): string; text(): string; find(selector: string): Shape[] };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number };
    const state = window as Window & { Konva?: { stages?: Stage[] }; __topologyRetainedBaseline?: { stage: Stage; cards: Map<string, Shape>; wires: Map<string, Shape>; camera: number[] } };
    const stage = state.Konva?.stages?.[0];
    const baseline = state.__topologyRetainedBaseline;
    if (!stage || !baseline) throw new Error('BFCache scene baseline was lost');
    const cards = new Map(stage.find('.topology-card').map((card): [string, Shape] => [
      card.find('Text').map((text) => text.text()).find((name) => name === 'Controller' || name === 'Scheduler') ?? '', card
    ]));
    const wires = new Map(stage.find('.topology-wire').map((wire): [string, Shape] => [wire.id(), wire]));
    return {
      sameStage: stage === baseline.stage,
      sameCards: [...baseline.cards].every(([name, card]) => cards.get(name) === card),
      sameWires: [...baseline.wires].every(([id, wire]) => wires.get(id) === wire),
      camera: [stage.x(), stage.y(), stage.scaleX(), stage.scaleY()],
      baselineCamera: baseline.camera
    };
  });
  expect(after).toEqual({ sameStage: true, sameCards: true, sameWires: true, camera: before.camera, baselineCamera: before.camera });
  expect(requests).toHaveLength(requestCount);
});

test('real titles navigate safely by click and keyboard while drags remain card gestures', async ({ page }) => {
  const requests = await installLocalFixture(page);
  await page.route((url) => url.origin === experimentOrigin && url.pathname === '/nodes/Controller/', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'local node route' }));
  await page.route((url) => url.origin === experimentOrigin && url.pathname === '/nodes/TouchPanel/', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'local special-name route' }));
  await page.route((url) => url.origin === experimentOrigin && url.pathname === '/nodes.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'network search route' }));
  await openLocalFixture(page, requests);
  const resetLocal = async () => {
    requests.length = 0;
    await page.goto('/topology-canvas.html?source=local');
    await waitForLocalCanvas(page);
    await expect.poll(() => requests.filter(({ pathname }) => pathname === '/REST/nodeURLsForNode').length).toBe(1);
  };
  await page.evaluate(() => history.pushState(null, '', '/nested/experiment/topology-canvas.html?source=local'));

  const titlePoint = (name: string) => page.evaluate((title) => {
    type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top?: Shape): { x: number; y: number }; width(): number; height(): number };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; getContent(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find((candidate) => candidate.find('Text').some((text) => text.text() === title));
    const label = card?.find('Text').find((text) => text.text() === title);
    if (!stage || !label) throw new Error(`Missing ${title} title`);
    const point = label.getAbsolutePosition(stage);
    const local = { x: stage.x() + (point.x + Math.min(label.width() / 2, 20)) * stage.scaleX(), y: stage.y() + (point.y + label.height() / 2) * stage.scaleY() };
    const bounds = stage.getContent().getBoundingClientRect();
    return { x: bounds.left + local.x, y: bounds.top + local.y };
  }, name);

  const controllerTitle = await titlePoint('Controller');
  const beforeDrag = await readCardPosition(page, 'Controller');
  await page.mouse.move(controllerTitle.x, controllerTitle.y);
  await page.mouse.down();
  await page.mouse.move(controllerTitle.x + 45, controllerTitle.y + 28, { steps: 4 });
  await page.mouse.up();
  await expect(page).toHaveURL(/nested\/experiment\/topology-canvas\.html\?source=local/);
  const afterDrag = await readCardPosition(page, 'Controller');
  expect(afterDrag.x).not.toBe(beforeDrag.x);

  const specialLocalTitle = await titlePoint('Touch Panel');
  await page.mouse.click(specialLocalTitle.x, specialLocalTitle.y);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/nodes/TouchPanel/');
  expect(new URL(page.url()).origin).toBe(experimentOrigin);

  await resetLocal();
  await page.evaluate(() => history.pushState(null, '', '/nested/experiment/topology-canvas.html?source=local'));
  const nextControllerTitle = await titlePoint('Controller');
  await page.mouse.move(nextControllerTitle.x, nextControllerTitle.y);
  const stageHost = page.locator('.canvas-stage');
  expect(await stageHost.evaluate((element) => (element as HTMLElement).style.cursor)).toBe('pointer');
  await expect(stageHost).toHaveAttribute('title', /Hosted on this page’s Nodel server\. .*Open Controller\./);
  await expect(stageHost).toHaveAttribute('aria-label', /Controller\. Hosted on this page’s Nodel server\. .*Open Controller\./);
  await page.mouse.move(0, 0);
  expect(await stageHost.evaluate((element) => (element as HTMLElement).style.cursor)).toBe('');
  await page.mouse.move(nextControllerTitle.x, nextControllerTitle.y);
  await page.mouse.click(nextControllerTitle.x, nextControllerTitle.y, { button: 'right' });
  await expect(page).toHaveURL(/nested\/experiment\/topology-canvas\.html\?source=local/);
  await page.mouse.click(nextControllerTitle.x, nextControllerTitle.y);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/nodes/Controller/');
  expect(new URL(page.url()).origin).toBe(experimentOrigin);

  await resetLocal();
  const fallbackTitle = await titlePoint('Projector Left');
  await page.mouse.move(fallbackTitle.x, fallbackTitle.y);
  await expect(page.locator('.canvas-stage')).toHaveAttribute('aria-label', /Find Projector Left on Network/);
  await page.mouse.click(fallbackTitle.x, fallbackTitle.y);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/nodes.html');
  expect(new URL(page.url()).searchParams.get('filter')).toBe('Projector Left');
  expect(new URL(page.url()).hash).toBe('#Network');
  expect(new URL(page.url()).origin).toBe(experimentOrigin);

  await resetLocal();
  await expect(stageHost).toHaveAttribute('aria-label', /Enter opens its title/);
  await stageHost.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/nodes/Controller/');

  await resetLocal();
  await stageHost.focus();
  await page.keyboard.press('ArrowRight');
  const touchPanelTitle = await titlePoint('Touch Panel');
  await page.mouse.click(touchPanelTitle.x + 100, touchPanelTitle.y + 50);
  await stageHost.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/nodes/TouchPanel/');

  await resetLocal();
  await stageHost.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/topology-canvas.html');
});

test('canonical-ambiguous local titles have no fabricated local address', async ({ page }) => {
  const requests = await installLocalFixture(page, { inventory: { nodes: { 'Canonical Owner': {}, 'Canonical Owner ()': {} } } });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect.poll(() => requests.filter(({ pathname }) => pathname === '/REST').length).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    type Title = { text(): string; name(): string; getAttr(name: string): unknown; find(selector: string): Title[] };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Title[] }> } }).Konva?.stages?.[0];
    return stage?.find('.topology-card').flatMap((card) => card.find('Text'))
      .filter((shape) => shape.text() === 'Canonical Owner')
      .map((shape) => ({ title: shape.text(), name: shape.name(), href: shape.getAttr('navigationHref') }))
      .sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  })).toEqual([
    { title: 'Canonical Owner', name: 'topology-node-title', href: undefined }
  ]);

  const point = await page.evaluate(() => {
    type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top: Shape): { x: number; y: number }; width(): number; height(): number };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; getContent(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const title = stage?.find('.topology-card').flatMap((card) => card.find('Text')).find((shape) => shape.text() === 'Canonical Owner');
    if (!stage || !title) throw new Error('Missing canonical-ambiguous title');
    const position = title.getAbsolutePosition(stage);
    const content = stage.getContent().getBoundingClientRect();
    return {
      x: content.left + stage.x() + (position.x + 20) * stage.scaleX(),
      y: content.top + stage.y() + (position.y + title.height() / 2) * stage.scaleY()
    };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page).toHaveURL(/topology-canvas\.html\?source=local/);
});

test('mouse card selection synchronizes Enter and Escape clears its target', async ({ page }) => {
  await installLocalFixture(page);
  await page.route((url) => url.origin === experimentOrigin && url.pathname === '/nodes/TouchPanel/', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'local node route' }));
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  const stageHost = page.locator('.canvas-stage');
  await stageHost.focus();
  await page.keyboard.press('ArrowRight');

  const bodyPoint = await page.evaluate(() => {
    type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top: Shape): { x: number; y: number } };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; getContent(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === 'Touch Panel'));
    if (!stage || !card) throw new Error('Touch Panel card is missing');
    const position = card.getAbsolutePosition(stage);
    const content = stage.getContent().getBoundingClientRect();
    return {
      x: content.left + stage.x() + (position.x + 100) * stage.scaleX(),
      y: content.top + stage.y() + (position.y + 70) * stage.scaleY()
    };
  });
  await page.mouse.click(bodyPoint.x, bodyPoint.y);
  await stageHost.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/nodes/TouchPanel/');

  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await stageHost.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/topology-canvas.html');
});

test('local source is selected during pending inventory and can return to synthetic 9', async ({ page }) => {
  const requests = await installGuard(page, async () => new Promise<void>(() => {}));
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'commit' });
  await expect(page.getByLabel('Graph source')).toHaveValue('local');
  await expect(page.locator('[data-topology-scrim]')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.topologyStartupShell));
  await expect(page.locator('[data-topology-show-now]')).toHaveJSProperty('hidden', await page.evaluate(() => window.topologyStartupShell!.released));
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page).not.toHaveURL(/source=local/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await expect(page.locator('.canvas-failure')).toBeHidden();
  expect(requests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);
});

test('local mode uses only scoped GETs, renders local/reference cards and wires, and preserves gestures', async ({ page }) => {
  const requests = await installLocalFixture(page);
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, 'fillText')?.value as CanvasRenderingContext2D['fillText'] | undefined;
    const originalCurve = Object.getOwnPropertyDescriptor(prototype, 'bezierCurveTo')?.value as CanvasRenderingContext2D['bezierCurveTo'] | undefined;
    if (!original || !originalCurve) throw new Error('Canvas text and curve methods are unavailable');
    prototype.fillText = function (text: string, x: number, y: number, ...rest: [number?]) {
      const transform = this.getTransform();
      const point = transform.transformPoint(new DOMPoint(x, y));
      const canvas = this.canvas;
      const bounds = canvas.getBoundingClientRect();
      const labels = ((window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ??= []);
      labels.push({ text: String(text), x: bounds.left + point.x * bounds.width / canvas.width, y: bounds.top + point.y * bounds.height / canvas.height });
      return Reflect.apply(original, this, [text, x, y, ...rest]);
    };
    prototype.bezierCurveTo = function (...coordinates: [number, number, number, number, number, number]) {
      const state = window as Window & { __konvaCurveCount?: number };
      state.__konvaCurveCount = (state.__konvaCurveCount ?? 0) + 1;
      return Reflect.apply(originalCurve, this, coordinates);
    };
  });
  await openLocalFixture(page, requests);
  await expect(page.locator('[data-fixture-summary]')).toContainText('5 nodes');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 no-route');
  await expect(page.locator('.experiment-header h1')).toHaveText('Local network topology');
  const initialHeaderScene = await page.evaluate(() => {
    type Shape = {
      name(): string; text(): string; x(): number; y(): number; width(): number; height(): number;
      find(selector: string): Shape[]; getChildren(): Shape[]; getAttr(name: string): unknown;
      strokeWidth(): number; points(): number[]; getClientRect(config?: { skipTransform?: boolean; relativeTo?: Shape }): { x: number; y: number; width: number; height: number };
      getClassName(): string; getAbsolutePosition(top?: Shape): { x: number; y: number };
      name(): string;
    };
    type Stage = Shape & { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable while inspecting host indicators');
    const cards = stage.find('.topology-card').map((card) => {
      const texts = card.find('Text').map((text) => text.text());
      const title = texts.find((text) => ['Controller', 'Touch Panel', 'Scheduler', 'Idle Local', 'Projector Left'].includes(text));
      const rect = card.find('Rect').find((shape) => shape.width() > 100);
      if (!title || !rect) throw new Error('A fixture card is missing its title or body');
      const titleShape = card.find('Text').find((shape) => shape.text() === title);
      const glyph = card.getChildren().find((shape) => shape.name().startsWith('host-location-'));
      if (!titleShape || (title !== 'Projector Left' && !glyph)) throw new Error('A fixture card is missing its title shape or host glyph');
      // relativeTo the card returns card-local coordinates even when the camera
      // is zoomed or panned; only visible children contribute stroke-inclusive bounds.
      const rawGlyphBounds = glyph?.getChildren().filter((shape) => shape.getAttr('visible') !== false)
        .map((shape) => shape.getClientRect({ relativeTo: card }))
        .reduce((bounds, current) => {
          if (!bounds) return current;
          const left = Math.min(bounds.x, current.x);
          const top = Math.min(bounds.y, current.y);
          const right = Math.max(bounds.x + bounds.width, current.x + current.width);
          const bottom = Math.max(bounds.y + bounds.height, current.y + current.height);
          return { x: left, y: top, width: right - left, height: bottom - top };
        }, undefined as { x: number; y: number; width: number; height: number } | undefined);
      const glyphBounds = rawGlyphBounds;
      const titleBounds = titleShape.getClientRect({ relativeTo: card });
      // A rail can also contain an empty Text. Inspect the header subtitle,
      // not arbitrary descendants of the card.
      const subtitles = card.getChildren().filter(shape => shape.getClassName() === 'Text' && shape.y() === 35);
      if (subtitles.length !== 1) throw new Error(`Missing or ambiguous header subtitle for ${title}`);
      return {
        title, position: { x: card.x(), y: card.y() }, size: { width: rect.width(), height: rect.height() }, texts,
        description: card.getAttr('accessibleDescription'), titleX: titleShape.x(), titleY: titleShape.y(),
        titleInkCenterY: titleBounds.y + titleBounds.height / 2,
        subtitle: { text: subtitles[0].text(), visible: subtitles[0].getAttr('visible') !== false },
        glyphBounds, glyphY: glyph?.y(), glyphChildren: glyph?.getChildren().map((shape) => ({ name: shape.name(), className: shape.getClassName(), visible: shape.getAttr('visible'), points: shape.points?.() ?? [] })) ?? [], glyphName: glyph?.name()
      };
    });
    const glyphs = stage.find('.topology-card').flatMap((card) => card.getChildren()).filter((shape) => shape.name().startsWith('host-location-'));
    const state = window as Window & { __hostBadgeRefs?: Array<{ group: Shape; children: Shape[] }> };
    state.__hostBadgeRefs = glyphs.map((group) => ({ group, children: group.getChildren() }));
    return {
      cards,
    glyphs: glyphs.map((shape) => ({
      name: shape.name(),
      strokes: shape.getChildren().map((child) => child.getAttr('stroke')).filter((stroke): stroke is string => typeof stroke === 'string'),
      childNames: shape.getChildren().map((child) => child.name()),
      bounds: shape.getChildren().filter((child) => child.getAttr('visible') !== false)
        .map((child) => child.getClientRect({ skipTransform: true }))
        .reduce((bounds, current) => {
          if (!bounds) return current;
          const left = Math.min(bounds.x, current.x);
          const top = Math.min(bounds.y, current.y);
          const right = Math.max(bounds.x + bounds.width, current.x + current.width);
          const bottom = Math.max(bounds.y + bounds.height, current.y + current.height);
          return { x: left, y: top, width: right - left, height: bottom - top };
        }, undefined as { x: number; y: number; width: number; height: number } | undefined)
    })).sort((left, right) => left.name.localeCompare(right.name))
    };
  });
  expect(initialHeaderScene.glyphs.map(({ name }) => name)).toEqual([
    'host-location-local', 'host-location-local', 'host-location-local', 'host-location-local', 'host-location-unknown'
  ]);
  expect(initialHeaderScene.glyphs.every(({ childNames }) => !childNames.some((name) => name.startsWith('host-server')))).toBe(true);
  const arrowCard = initialHeaderScene.cards.find(({ title }) => title === 'Touch Panel');
  const arrow = arrowCard?.glyphChildren.filter(({ name, className }) => className === 'Line' && name === 'host-arrow');
  expect(arrow?.map(({ points }) => points)).toEqual([[0, 6, 14, -8, 9, -8], [14, -8, 14, -3]]);
  expect(arrow?.every(({ points }) => points.some((value, index) => index % 2 === 0 && value > 0)
    && points.some((value, index) => index % 2 === 1 && value < 0))).toBe(true);
  for (const card of initialHeaderScene.cards.filter(({ glyphBounds }) => glyphBounds)) {
    const glyphCenterY = card.glyphBounds!.y + card.glyphBounds!.height / 2;
    expect(card.glyphBounds!.y, `${card.title} visible top clearance`).toBeGreaterThanOrEqual(8);
    expect(glyphCenterY).toBeCloseTo(card.titleInkCenterY, 0);
    // Konva client rect includes the visible strokes; its right edge is inset
    // by the same 16px as the card title's left edge.
    const glyphRightInset = card.size.width - (card.glyphBounds!.x + card.glyphBounds!.width);
    expect(glyphRightInset).toBeCloseTo(card.titleX, 0);
  }
  for (const card of initialHeaderScene.cards) {
    const qualifier = card.title === 'Projector Left' ? 'No advertised route' : '';
    expect(card.subtitle, `${card.title} header qualifier`).toEqual({ text: qualifier, visible: Boolean(qualifier) });
  }
  const badgeStrokes = initialHeaderScene.glyphs.flatMap(({ strokes }) => strokes);
  expect(new Set(badgeStrokes).size).toBe(1);
  expect(badgeStrokes[0]).toMatch(/^rgb\(/);
    expect(initialHeaderScene.cards.find(({ title }) => title === 'Controller')?.texts).toContain('');
    expect(initialHeaderScene.cards.find(({ title }) => title === 'Projector Left')?.texts).toContain('No advertised route');
  expect(initialHeaderScene.cards.find(({ title }) => title === 'Projector Left')?.description).toContain('Host location is unknown');
  expect(initialHeaderScene.cards.find(({ title }) => title === 'Idle Local')?.texts).toContain('');
  expect(initialHeaderScene.cards.find(({ title }) => title === 'Controller')?.description).toContain('Inspection succeeded; 4 configured bindings, 1 unassigned binding.');
  expect(initialHeaderScene.cards.find(({ title }) => title === 'Scheduler')?.description).toContain('Inspection succeeded; 1 configured binding, none unassigned.');
  expect(initialHeaderScene.cards.find(({ title }) => title === 'Projector Left')?.description).toContain('No advertised route.');

  const alignCurrentGlyphs = async () => {
    const current = await page.evaluate(() => {
      type Shape = {
        name(): string; text(): string; x(): number; y(): number; width(): number; height(): number;
        find(selector: string): Shape[]; getChildren(): Shape[]; getAttr(name: string): unknown;
        getClientRect(config?: { skipTransform?: boolean; relativeTo?: Shape }): { x: number; y: number; width: number; height: number };
      };
      type Stage = Shape & { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Konva stage unavailable while rechecking host glyph alignment');
      return stage.find('.topology-card').map((card) => {
        const texts = card.find('Text');
        const title = texts.find((text) => ['Controller', 'Touch Panel', 'Scheduler', 'Idle Local', 'Projector Left'].includes(text.text()));
        const glyph = card.getChildren().find((shape) => shape.name().startsWith('host-location-'));
        const rects = glyph?.getChildren().filter((shape) => shape.getAttr('visible') !== false)
          .map((shape) => shape.getClientRect({ relativeTo: card }));
        if (!title || !glyph || !rects?.length) return undefined;
        const bounds = rects.reduce((result, current) => {
          if (!result) return current;
          const left = Math.min(result.x, current.x);
          const top = Math.min(result.y, current.y);
          const right = Math.max(result.x + result.width, current.x + current.width);
          const bottom = Math.max(result.y + result.height, current.y + current.height);
          return { x: left, y: top, width: right - left, height: bottom - top };
        });
        const titleRect = title.getClientRect({ relativeTo: card });
        return {
          title: title.text(), subtitleVisible: texts.some((text) => text !== title && text.name() === '' && text.text() !== '' && text.getAttr('visible') !== false),
          glyphTop: bounds.y, glyphBottom: bounds.y + bounds.height,
          glyphCenterY: bounds.y + bounds.height / 2,
          titleInkCenterY: titleRect.y + titleRect.height / 2
        };
      }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    });
    expect(current).toHaveLength(5);
    for (const entry of current) {
      expect(entry.glyphTop, `${entry.title} visible top clearance`).toBeGreaterThanOrEqual(8);
      expect(Math.abs(entry.glyphCenterY - entry.titleInkCenterY), `${entry.title} visual center versus title ink`).toBeLessThanOrEqual(1);
    }
    return current;
  };
  const assertCurrentGlyphAlignment = async (subtitleVisible: boolean) => {
    const current = await alignCurrentGlyphs();
    expect(current.filter((entry) => entry.title === 'Idle Local').every((entry) => entry.subtitleVisible === subtitleVisible)).toBe(true);
  };
  const assertSubtitleToggleAlignment = async () => {
    await page.evaluate(() => {
      type Shape = { name(): string; text(value?: string): string | void; visible(value?: boolean): boolean | void; find(selector: string): Shape[] };
      type Stage = Shape & { find(selector: string): Shape[]; batchDraw(): void };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const card = stage?.find('.topology-card').find((entry) => entry.find('Text').some((text) => text.text() === 'Idle Local'));
      const texts = card?.find('Text');
      const title = texts?.find((text) => text.text() === 'Idle Local');
        const subtitle = texts?.find((text) => text !== title && text.name() === '');
      if (!stage || !subtitle) throw new Error('Idle Local subtitle shape is unavailable for transition test');
      subtitle.text('Temporary subtitle');
      subtitle.visible(true);
      stage.batchDraw();
    });
    await assertCurrentGlyphAlignment(true);
    await page.evaluate(() => {
      type Shape = { name(): string; text(value?: string): string | void; visible(value?: boolean): boolean | void; find(selector: string): Shape[] };
      type Stage = Shape & { find(selector: string): Shape[]; batchDraw(): void };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const card = stage?.find('.topology-card').find((entry) => entry.find('Text').some((text) => text.text() === 'Idle Local'));
      const texts = card?.find('Text');
      const subtitle = texts?.find((text) => text.name() === '' && text !== texts.find((candidate) => candidate.text() === 'Idle Local'));
      if (!stage || !subtitle) throw new Error('Temporary subtitle shape is unavailable for removal test');
      subtitle.text('');
      subtitle.visible(false);
      stage.batchDraw();
    });
    await assertCurrentGlyphAlignment(false);
  };

  // Screenshots are evidence outputs, not checked-in baselines.
  await mkdir(artifactDir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await assertLocalLoopFitsViewport(page);
  await page.screenshot({ path: resolve(artifactDir, 'local-mode-1366x768.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await assertLocalLoopFitsViewport(page);
  await page.screenshot({ path: resolve(artifactDir, 'local-mode-1920x1080.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'Reset view' }).click();
  await assertSubtitleToggleAlignment();
  await mkdir(headerIndicatorArtifactDir, { recursive: true });
  await page.screenshot({ path: resolve(headerIndicatorArtifactDir, 'after-light.png'), animations: 'disabled' });
  await assertCurrentGlyphAlignment(false);
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBadgePaint = await page.evaluate(() => {
    type Shape = { name(): string; fill(): string; stroke(): string; getChildren(): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable while checking dark badge paint');
    const style = getComputedStyle(document.documentElement);
    return {
      muted: `rgb(${style.getPropertyValue('--nodel-muted').trim()})`,
      surface: `rgb(${style.getPropertyValue('--nodel-surface').trim()})`,
      glyphs: stage.find('.topology-card').flatMap((card) => card.getChildren()).filter((shape) => shape.name().startsWith('host-location-'))
        .map((glyph) => ({ name: glyph.name(), children: glyph.getChildren().map((child) => ({ name: child.name(), fill: child.fill(), stroke: child.stroke() })) }))
    };
  });
  expect(darkBadgePaint.glyphs).toHaveLength(5);
  for (const glyph of darkBadgePaint.glyphs) {
    for (const child of glyph.children) {
      if (child.stroke) expect(child.stroke).toBe(darkBadgePaint.muted);
        if (child.name === 'host-question-badge') expect(child.fill).toBe(darkBadgePaint.surface);
        if (child.name === 'host-question-mark') expect(child.fill).toBe(darkBadgePaint.muted);
    }
  }
  const stableBadgeChildren = await page.evaluate(() => {
    const state = window as Window & { __hostBadgeRefs?: Array<{ group: object; children: object[] }>; Konva?: { stages?: Array<{ find(selector: string): Array<{ name(): string; getChildren(): object[] }> }> } };
    const glyphs = state.Konva?.stages?.[0]?.find('.topology-card').flatMap((card) => card.getChildren()).filter((shape) => shape.name().startsWith('host-location-'));
    return Boolean(glyphs && state.__hostBadgeRefs && glyphs.length === state.__hostBadgeRefs.length && glyphs.every((glyph, index) =>
      glyph === state.__hostBadgeRefs![index]!.group && glyph.getChildren().every((child, childIndex) => child === state.__hostBadgeRefs![index]!.children[childIndex])
    ));
  });
  expect(stableBadgeChildren).toBe(true);
  await page.screenshot({ path: resolve(artifactDir, 'local-mode-dark.png'), animations: 'disabled' });
  await page.screenshot({ path: resolve(headerIndicatorArtifactDir, 'after-dark.png'), animations: 'disabled' });
  await assertCurrentGlyphAlignment(false);

  const stageHost = page.locator('.canvas-stage');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const initialAccessibleDescription = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.canvas-stage');
    return { role: host?.getAttribute('role'), label: host?.getAttribute('aria-label'), title: host?.title };
  });
  expect(initialAccessibleDescription.role).toBe('img');
  expect(initialAccessibleDescription.label).toContain('Arrow keys select a card');
  const compactSummary = await page.locator('[data-fixture-summary]').textContent();
  await stageHost.focus();
  // Move through the same card order used by keyboard navigation and land on
  // the confirmed-empty local node; its full text description must be exposed.
  const idleLocalIndex = initialHeaderScene.cards.findIndex(({ title }) => title === 'Idle Local');
  if (idleLocalIndex < 0) throw new Error('Idle Local card is missing from the deterministic fixture');
  for (let index = 1; index <= idleLocalIndex; index += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.canvas-stage').evaluate((element) => (element as HTMLElement).title))
    .toContain('Inspection succeeded; 0 configured bindings, none unassigned.');
  const idleDescription = 'Idle Local. Hosted on this page’s Nodel server. Inspection succeeded; 0 configured bindings, none unassigned. Open Idle Local. Press [ and ] to inspect port names; P opens ports and bindings.';
  await expect(stageHost).toHaveAttribute('aria-label', idleDescription);
  await expect(page.locator('[data-fixture-summary]')).toHaveText(compactSummary ?? '');
  await expect(page.locator('.canvas-failure')).toHaveClass(/is-visually-hidden/);
  await expect(page.locator('.canvas-failure')).toContainText('Idle Local. Hosted on this page’s Nodel server. Inspection succeeded; 0 configured bindings, none unassigned.');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const hoveredCardPoint = await page.evaluate(() => {
    type Shape = { text(): string; find(selector: string): Shape[]; x(): number; y(): number; width(): number; height(): number; getAbsolutePosition(top: Shape): { x: number; y: number } };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; container(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === 'Controller'));
    if (!stage || !card) throw new Error('Controller card unavailable for tooltip priority check');
    const portLabel = card.find('Text').find(text => text.y() > 50 && text.width() > 12);
    if (!portLabel) throw new Error('Controller port label unavailable for tooltip priority check');
    const position = portLabel.getAbsolutePosition(stage);
    const bounds = stage.container().getBoundingClientRect();
    return { x: bounds.left + stage.x() + (position.x + 6) * stage.scaleX(), y: bounds.top + stage.y() + (position.y + 7) * stage.scaleY() };
  });
  await page.mouse.move(hoveredCardPoint.x, hoveredCardPoint.y);
  await expect(stageHost).toHaveAttribute('aria-label', idleDescription);
  await expect(page.locator('[data-fixture-summary]')).toHaveText(compactSummary ?? '');
  await page.keyboard.press('ArrowRight');
  await expect(stageHost).toHaveAttribute('aria-label', /^(?!Idle Local\.).+/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText(compactSummary ?? '');
  await page.keyboard.press('Escape');
  const cameraBeforeZoom = await page.evaluate(() => {
    const stage = (window as Window & { Konva?: { stages?: Array<{ scaleX(): number; x(): number; y(): number }> } }).Konva?.stages?.[0];
    return stage ? { scale: stage.scaleX(), x: stage.x(), y: stage.y() } : undefined;
  });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { Konva?: { stages?: Array<{ scaleX(): number }> } }).Konva?.stages?.[0]?.scaleX())).not.toBe(cameraBeforeZoom?.scale);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  const finalHeaderScene = await page.evaluate(() => {
    type Shape = { name(): string; text(): string; x(): number; y(): number; width(): number; height(): number; find(selector: string): Shape[] };
    type Stage = Shape & { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable after zoom');
    return stage.find('.topology-card').map((card) => {
      const texts = card.find('Text').map((text) => text.text());
      const title = texts.find((text) => ['Controller', 'Touch Panel', 'Scheduler', 'Idle Local', 'Projector Left'].includes(text));
      const rect = card.find('Rect').find((shape) => shape.width() > 100);
      if (!title || !rect) throw new Error('A card disappeared while zooming');
      return { title, position: { x: card.x(), y: card.y() }, size: { width: rect.width(), height: rect.height() } };
    });
  });
  expect(finalHeaderScene).toEqual(initialHeaderScene.cards.map(({ title, position, size }) => ({ title, position, size })));
  expect(requests.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([
    'GET /REST', 'GET /nodes/Controller/REST/remote', 'GET /nodes/IdleLocal/REST/remote',
    'GET /nodes/Scheduler/REST/remote', 'GET /nodes/TouchPanel/REST/remote', 'POST /REST/nodeURLsForNode'
  ]);

  const labels = await page.evaluate(() => (window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ?? []);
  for (const name of ['Controller', 'Touch Panel', 'Scheduler', 'Idle Local', 'Projector Left']) {
    expect(labels.some((label) => label.text === name), `rendered card title ${name}`).toBe(true);
  }
  for (const state of ['No advertised route']) {
    expect(labels.some((label) => label.text.toLowerCase() === state.toLowerCase()), `rendered state ${state}`).toBe(true);
  }
  // Five configured connections render as four ordinary curves plus the
  // three-segment exterior self-loop; both scene and hit canvases paint them.
  expect(await page.evaluate(() => (window as Window & { __konvaCurveCount?: number }).__konvaCurveCount ?? 0)).toBeGreaterThanOrEqual(14);

  // Zoom, pan the stage in empty space, then select and drag a rendered card.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const stage = page.locator('.canvas-stage');
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Canvas stage has no bounds');
  await page.mouse.move(bounds.x + 16, bounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 72, bounds.y + 66, { steps: 4 });
  await page.mouse.up();
  const updatedLabels = await page.evaluate(() => (window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ?? []);
  const controller = [...updatedLabels].reverse().find((label) => label.text === 'Controller');
  const touchPanel = [...updatedLabels].reverse().find((label) => label.text === 'Touch Panel');
  expect(controller, 'Controller remains rendered after zoom and pan').toBeDefined();
  expect(touchPanel, 'Touch Panel remains rendered after zoom and pan').toBeDefined();
  if (!controller || !touchPanel) return;
  const loopBeforeMove = await readControllerSelfLoop(page);
  const beforeSelection = await page.screenshot();
  await page.mouse.click(touchPanel.x + 35, touchPanel.y + 45);
  const afterSelection = await page.screenshot();
  expect(afterSelection.equals(beforeSelection), 'physical card click changes selected rendering').toBe(false);
  await page.mouse.move(controller.x + 35, controller.y - 10);
  await page.mouse.down();
  await page.mouse.move(controller.x + 75, controller.y + 18, { steps: 5 });
  await page.mouse.up();
  const draggedLabels = await page.evaluate(() => (window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ?? []);
  const movedController = [...draggedLabels].reverse().find((label) => label.text === 'Controller');
  expect(movedController?.x).toBeGreaterThan(controller.x + 20);
  expect(movedController?.y).toBeGreaterThan(controller.y + 10);
  const movedLoop = await readControllerSelfLoop(page);
  expect(movedLoop.edgeId).toBe(loopBeforeMove.edgeId);
  expect(movedLoop.groupPosition.x).toBeGreaterThan(loopBeforeMove.groupPosition.x + 20);
  expect(movedLoop.groupPosition.y).toBeGreaterThan(loopBeforeMove.groupPosition.y + 10);
  expect(Math.hypot(movedLoop.curves[0]!.start.x - movedLoop.from.x, movedLoop.curves[0]!.start.y - movedLoop.from.y)).toBeLessThan(0.1);
  expect(Math.hypot(movedLoop.curves.at(-1)!.end.x - movedLoop.to.x, movedLoop.curves.at(-1)!.end.y - movedLoop.to.y)).toBeLessThan(0.1);
  const beforeWireSelection = await page.screenshot();
  await page.mouse.click(movedLoop.screenMidpoint.x, movedLoop.screenMidpoint.y);
  const afterWireSelection = await page.screenshot();
  expect(afterWireSelection.equals(beforeWireSelection), 'physical wire click changes selected wire and socket rendering').toBe(false);
  const selectedLoop = await readControllerSelfLoop(page);
  expect(selectedLoop.edgeId).toBe(movedLoop.edgeId);
  expect(selectedLoop.curves.every((curve) => curve.strokeStyle === selectedLoop.action)).toBe(true);
  expect(selectedLoop.fromSocket.fill).toBe('rgb(255 255 255)');
  expect(selectedLoop.fromSocket.stroke).toBe(selectedLoop.action);
  expect(selectedLoop.toSocket.fill).toBe(selectedLoop.action);
  expect(selectedLoop.toSocket.stroke).toBe(selectedLoop.action);
  expect(selectedLoop.otherSocket.fill).not.toBe(selectedLoop.action);
  expect(requests).toHaveLength(6);
});

test('physical wire selection keeps a shared socket highlighted through theme and view reset', async ({ page }) => {
  const requests = await installGuard(page, async (route, { pathname }) => {
    if (pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Alpha: {}, Bravo: {} } }));
    } else if (pathname === '/nodes/Alpha/REST/remote' || pathname === '/nodes/Bravo/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { Call: { node: 'Receiver', action: 'Accept' } } }));
    } else {
      throw new Error(`Unexpected shared-socket fixture request ${pathname}`);
    }
  }, { emptyDiscoveryNames: ['Receiver'] });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('3 nodes · 2 complete · 0 partial · 0 queued · 0 terminal not inspected · 1 no-route');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);

  const inspect = () => page.evaluate(async () => {
    // Konva schedules hit-canvas redraws after a camera or selection change.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    type Point = { x: number; y: number };
    type PathContext = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'bezierCurveTo' | 'lineTo' | 'closePath' | 'stroke' | 'fill' | 'strokeStyle'> & { strokeShape(shape: Shape): void; fillShape(shape: Shape): void };
    type Shape = {
      id(): string; name(): string; text(): string; fill(): string; stroke(): string;
      find(selector: string): Shape[]; getAbsolutePosition(top: Shape): Point;
      getHitFunc(): (context: PathContext, shape: Shape) => void;
    };
    type Stage = Shape & {
      getContent(): HTMLElement; getIntersection(point: Point): Shape | null;
      getAbsoluteTransform(): { point(point: Point): Point };
      x(): number; y(): number; scaleX(): number; width(): number; height(): number;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const socket = (title: string) => {
      const card = stage.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === title));
      const sockets = card?.find('Circle').filter((circle) => circle.name().startsWith('socket-'));
      if (sockets?.length !== 1) throw new Error(`Expected one socket on ${title}`);
      const terminal = sockets[0]!;
      return { point: terminal.getAbsolutePosition(stage), paint: { fill: terminal.fill(), stroke: terminal.stroke(), connectionSelected: Boolean(terminal.getAttr('connectionSelected')) } };
    };
    const alpha = socket('Alpha');
    const bravo = socket('Bravo');
    const shared = socket('Receiver');
    const bounds = stage.getContent().getBoundingClientRect();
    const wires = stage.find('.topology-wire').map((wire) => {
      let start = { x: 0, y: 0 };
      const curves: Array<{ start: Point; end: Point; midpoint: Point }> = [];
      const context: PathContext = {
        strokeStyle: '',
        moveTo(x, y) { start = { x, y }; },
        bezierCurveTo(a, b, c, d, x, y) {
          curves.push({ start, end: { x, y }, midpoint: { x: (start.x + 3 * a + 3 * c + x) / 8, y: (start.y + 3 * b + 3 * d + y) / 8 } });
        },
        beginPath() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, strokeShape() {}, fillShape() {}
      };
       wire.getHitFunc().call(wire, context, wire);
      const geometry = [...new Map(curves.map((curve) => [`${curve.start.x},${curve.start.y}:${curve.end.x},${curve.end.y}`, curve])).values()];
      const curve = geometry[0];
      if (geometry.length !== 1 || !curve) throw new Error('Expected one direct curve per shared-socket wire');
      const point = stage.getAbsoluteTransform().point(curve.midpoint);
      return {
        id: wire.id(), start: curve.start, end: curve.end,
        // The hit canvas uses stage-relative pixels; Playwright uses viewport pixels.
        hit: stage.getIntersection(point)?.id(),
        click: { x: bounds.left + point.x * bounds.width / stage.width(), y: bounds.top + point.y * bounds.height / stage.height() },
        // The custom scene function paints the selection, not the shape's stroke attribute.
        stroke: wire.stroke()
      };
    });
    const samePoint = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.1;
    const from = (source: typeof alpha) => {
      const wire = wires.find((item) => samePoint(item.start, source.point) && samePoint(item.end, shared.point));
      if (!wire) throw new Error('No rendered wire joins the source to the shared Receiver socket');
      return wire;
    };
    if (wires.length !== 2) throw new Error(`Expected two wires, got ${wires.length}`);
    const style = getComputedStyle(document.documentElement);
    const color = (token: string) => `rgb(${style.getPropertyValue(`--nodel-${token}`).trim()})`;
    return {
      wires: { alpha: from(alpha), bravo: from(bravo) },
      sockets: { alpha: alpha.paint, bravo: bravo.paint, shared: shared.paint },
      accent: color('accent'), muted: color('muted'), surface: color('surface'),
      action: color('topology-action'), actionStrong: color('topology-action-strong'),
      camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() },
      viewport: { width: stage.width(), height: stage.height() }
    };
  });

  const assertSelection = (scene: Awaited<ReturnType<typeof inspect>>, selected?: 'alpha' | 'bravo') => {
    const socketPaint = (active: boolean) => ({ fill: scene.surface, stroke: scene.action, connectionSelected: active });
    for (const key of ['alpha', 'bravo'] as const) {
      expect(scene.wires[key].stroke, `${key} wire core paint`).toBe(scene.action);
      expect(scene.sockets[key], `${key} private socket paint`).toEqual(socketPaint(selected === key));
    }
    expect(scene.sockets.shared, 'shared Receiver local-action socket paint').toEqual({
      fill: scene.action, stroke: scene.action, connectionSelected: selected !== undefined
    });
  };

  const initial = await inspect();
  assertSelection(initial);
  expect(initial.wires.alpha.id).not.toBe(initial.wires.bravo.id);
  for (const key of ['alpha', 'bravo'] as const) {
    const wire = initial.wires[key];
    expect(wire.hit, `${key} midpoint hits its own wire`).toBe(wire.id);
    await page.mouse.click(wire.click.x, wire.click.y);
    assertSelection(await inspect(), key);
  }

  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await inspect();
  expect(dark.accent).not.toBe(initial.accent);
  assertSelection(dark, 'bravo');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await inspect()).camera.scale).toBeGreaterThan(initial.camera.scale);
  await page.getByRole('button', { name: 'Reset view' }).click();
  const reset = await inspect();
  // Reset reframes the corrected local placements, while the actual graph
  // geometry and physical wire hit targets remain stable in world coordinates.
  expect(reset.camera.scale).toBe(initial.camera.scale);
  for (const key of ['alpha', 'bravo'] as const) {
    expect(reset.wires[key].id).toBe(initial.wires[key].id);
    expect(reset.wires[key].start).toEqual(initial.wires[key].start);
    expect(reset.wires[key].end).toEqual(initial.wires[key].end);
    expect(reset.wires[key].hit).toBe(reset.wires[key].id);
  }
  expect(reset.wires.alpha.click.y).toBeGreaterThanOrEqual(0);
  expect(reset.wires.alpha.click.y).toBeLessThan(reset.viewport.height);
  expect(reset.wires.bravo.click.y).toBeGreaterThanOrEqual(0);
  expect(reset.wires.bravo.click.y).toBeLessThan(reset.viewport.height);
  assertSelection(reset, 'bravo');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Alpha/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/Bravo/REST/remote', search: '' },
    { method: 'POST', pathname: '/REST/nodeURLsForNode', search: '' }
  ]);
});

async function assertLocalLoopFitsViewport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const bounds = await page.locator('.canvas-stage').boundingBox();
  if (!bounds) throw new Error('Canvas stage has no bounds');
  const loop = await page.evaluate(() => {
    type NativeText = { text(): string; getParent(): { y(): number } };
    type NativeStage = { y(): number; scaleY(): number; find(selector: string): NativeText[] };
    const stage = (window as Window & { Konva?: { stages?: NativeStage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const title = stage.find('Text').find((shape) => shape.text() === 'Controller');
    if (!title) throw new Error('Controller card title was not found');
    // local fixture's exterior loop uses control y = card top - 98 world px.
    return { controlY: stage.y() + (title.getParent().y() - 98) * stage.scaleY() };
  });
  // Controller's exterior self-loop is the uppermost local curve. Its Bezier
  // controls must stay within the fit margin after Reset at either viewport.
  expect(loop.controlY, JSON.stringify({ bounds, loop })).toBeGreaterThanOrEqual(16);
  expect(loop.controlY, JSON.stringify({ bounds, loop })).toBeLessThan(bounds.height - 16);
}

test('confirmed empty inventory differs from denied inventory failure', async ({ page }) => {
  const requests = await installLocalFixture(page, { emptyInventory: true });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-topology-status]')).toHaveText('No nodes found');
  await expect(page.locator('[data-topology-activity]')).toBeHidden();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  expect(requests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);

  await page.unrouteAll({ behavior: 'wait' });
  const deniedRequests = await installLocalFixture(page, { inventoryStatus: 403 });
  await page.reload();
  await expect(page.locator('[data-topology-status]')).toHaveText('No nodes found · coverage incomplete');
  await expect(page.locator('[data-topology-activity]')).toBeHidden();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  await expect(page.getByLabel('Graph source')).toHaveValue('local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('local inventory unavailable');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  expect(deniedRequests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);

  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page).not.toHaveURL(/source=local/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await expect(page.locator('.canvas-failure')).toBeHidden();
  expect(deniedRequests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);
});

test('local stage mount failure remains visible and selector still returns to synthetic 9', async ({ page }) => {
  const requests = await installLocalFixture(page);
  await page.addInitScript(() => {
    if (new URLSearchParams(window.location.search).get('source') !== 'local') return;
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        constructor() { throw new Error('forced mount failure'); }
      }
    });
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-failure')).toContainText('Local topology canvas could not be rendered.');
  await expect(page.locator('.canvas-failure')).toBeVisible();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  await expect(page.getByLabel('Graph source')).toHaveValue('local');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('4 local');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  expect(requests).toHaveLength(6);

  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page).not.toHaveURL(/source=local/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  expect(requests).toHaveLength(6);
});

test('a denied owner read is unreachable while a successful empty owner is confirmed local', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Denied Owner': {}, 'Empty Owner': {} } }));
    } else if (request.pathname === '/nodes/DeniedOwner/REST/remote') {
      await route.fulfill(jsonResponse({ error: 'do not expose this detail' }, 403));
    } else if (request.pathname === '/nodes/EmptyOwner/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else {
      throw new Error(`Unexpected local-mode request ${request.pathname}`);
    }
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');
  await expect(page.locator('[data-fixture-summary]')).toContainText('0 queued');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 complete');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 unreachable');
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/DeniedOwner/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/EmptyOwner/REST/remote', search: '' }
  ]);
});

test('bounded local owner reads settle independently and ignore late owner responses', async ({ page }) => {
  const requests: RequestRecord[] = [];
  let releaseLate: (() => Promise<void>) | undefined;
  let inventoryStartedAt: number | undefined;
  const ownerNames = Array.from({ length: 21 }, (_, index) => `Owner ${String(index).padStart(2, '0')}`);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') return route.fulfill(jsonResponse([]));
    const record = { method: request.method(), pathname: url.pathname, search: url.search };
    requests.push(record);
    if (record.method !== 'GET') return route.abort('blockedbyclient');
    if (url.pathname === '/REST') {
      inventoryStartedAt = Date.now();
      return route.fulfill(jsonResponse({ nodes: Object.fromEntries(ownerNames.map((name) => [name, {}])) }));
    }
    const owner = decodeURIComponent(url.pathname.split('/')[2] ?? '');
    if (owner === 'Owner00') return route.fulfill(jsonResponse({ actions: { 'Power On': { node: 'Projector Left', action: 'Power On' } } }));
    if (owner === 'Owner01') return route.fulfill(jsonResponse({}));
    if (owner === 'Owner14') return new Promise<void>((resolve) => { releaseLate = async () => { try { await route.fulfill(jsonResponse({ actions: { Late: { node: 'Owner 00', action: 'Late' } } })); } catch { /* The cutoff has already aborted this request. */ } finally { resolve(); } }; });
    // This route deliberately never settles before the actual wall-clock deadline.
    return new Promise<void>(() => {});
  });

  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled', { timeout: 15_000 });
  const elapsed = Date.now() - (inventoryStartedAt ?? Date.now());
  expect(elapsed).toBeGreaterThanOrEqual(2_500);
  expect(elapsed).toBeLessThan(15_000);
  await expect(page.locator('[data-fixture-summary]')).toContainText('22 nodes');
  await expect(page.locator('[data-fixture-summary]')).toContainText('19 unreachable');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 no-route');
  const afterCutoff = [...requests];
  expect(afterCutoff.filter(({ pathname }) => pathname === '/REST')).toHaveLength(1);
  const cutoffOwnerGets = afterCutoff.filter(({ pathname }) => pathname.endsWith('/REST/remote'));
  expect(cutoffOwnerGets).toHaveLength(21);
  expect(cutoffOwnerGets.map(({ pathname }) => decodeURIComponent(pathname.split('/')[2] ?? '')).sort())
    .toEqual(ownerNames.map((name) => name.replaceAll(' ', '')).sort());
  await releaseLate?.();
  await page.waitForTimeout(100);
  expect(requests).toEqual(afterCutoff);
  await expect(page.locator('[data-fixture-summary]')).toContainText('19 unreachable');
});

test('a true source close unload aborts local bootstrap before it can publish', async ({ page, context }) => {
  const requests: RequestRecord[] = [];
  let ownerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { ownerStarted = resolve; });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, location.href);
      if (url.pathname.startsWith('/nodes/')) {
        init?.signal?.addEventListener('abort', () => {
          try { localStorage.setItem('__konvaLocalOwnerAbort', 'true'); } catch { /* Browser storage is optional in a test. */ }
        }, { once: true });
      }
      return originalFetch(input, init);
    };
    window.addEventListener('pagehide', (event) => {
      try { localStorage.setItem('__konvaLocalPageHidePersisted', String(event.persisted)); } catch { /* Browser storage is optional in a test. */ }
    });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    ownerStarted?.();
    return new Promise<void>(() => {});
  });
  await page.goto('/topology-canvas.html?source=local');
  await started;
  await page.close();
  const statePage = await context.newPage();
  await statePage.goto('/topology-canvas.html?nodes=9');
  await expect.poll(() => statePage.evaluate(() => ({
    unloaded: localStorage.getItem('__konvaLocalPageHidePersisted'),
    aborted: localStorage.getItem('__konvaLocalOwnerAbort')
  }))).toEqual({ unloaded: 'false', aborted: 'true' });
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Controller/REST/remote', search: '' }
  ]);
  await statePage.close();
});

test('reciprocal actions with shared display name keep typed endpoints through physical card swaps', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example Frontend': {}, 'Example 2': {} } }));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: { Preset: { node: 'Example 2', action: 'power' } }
      }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { LogLevel: { node: 'Example Frontend', action: 'Preset' } } }));
    } else {
      throw new Error(`Unexpected reciprocal-wire fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const inspect = () => page.evaluate(() => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; height(): number; text(): string; align(): string;
      getAttr(name: string): unknown;
      fill(): string; stroke(): string; getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
      getHitFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillShape(shape: Shape): void; strokeShape(shape: Shape): void; fillStyle: string; strokeStyle: string; lineWidth: number;
      }, shape: Shape) => void;
    };
    type Stage = Shape & {
      getContent(): HTMLElement; getAbsoluteTransform(): { point(point: Pt): Pt }; scaleX(): number;
      getIntersection(point: Pt): Shape | null; x(): number; y(): number; scaleY(): number;
      getLayers(): Array<{ name(): string; getNativeCanvasElement(): HTMLCanvasElement }>;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const frontend = card('Example Frontend');
    const example2 = card('Example 2');
    if (!frontend || !example2) throw new Error('Reciprocal fixture cards were not rendered');
    const endpoint = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === (side === 'left' ? 'left' : 'right'));
      if (!text) throw new Error(`Missing ${side} ${label} endpoint label`);
      const socket = owner.find('Circle').find((item) => item.name().startsWith('socket-') && item.x() === (side === 'left' ? 0 : owner.find('Rect').find((rect) => rect.width() > 100)!.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing ${side} ${label} socket`);
      return { label, side, point: socket.getAbsolutePosition(stage), socket: { id: socket.name(), fill: socket.fill(), stroke: socket.stroke() } };
    };
    const feAction = endpoint(frontend, 'Preset', 'right');
    const feLocalPreset = endpoint(frontend, 'Preset', 'left');
    const exPower = endpoint(example2, 'power', 'left');
    const exLogLevel = endpoint(example2, 'LogLevel', 'right');
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const candidates: Array<{ id: string; curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }>; arrow?: Pt[]; color: string; hitPoint?: Pt }> = [];
    for (const wire of stage.find('.topology-wire')) {
      const curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }> = [];
      let start: Pt | undefined;
      let control1: Pt | undefined;
      let control2: Pt | undefined;
      let end: Pt | undefined;
      let move: Pt | undefined;
      let lines: Pt[] = [];
      let arrow: Pt[] | undefined;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { move = undefined; lines = []; },
        moveTo(x: number, y: number) { move = { x, y }; start = move; },
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { control1 = { x: a, y: b }; control2 = { x: c, y: d }; end = { x, y }; },
        lineTo(x: number, y: number) { lines.push({ x, y }); },
        closePath() {},
        stroke() { if (start && control1 && control2 && end) curves.push({ start, control1, control2, end }); },
        fill() { if (move && lines.length === 2) arrow = [move, ...lines]; },
        fillShape() { if (move && lines.length === 2) arrow = [move, ...lines]; }, strokeShape() { if (start && control1 && control2 && end) curves.push({ start, control1, control2, end }); }
      };
      wire.getHitFunc().call(wire, context, wire);
      const bezier = (curve: typeof curves[number], t: number): Pt => {
        const u = 1 - t;
        return {
          x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        };
      };
      const hitPoint = curves.flatMap((curve) => [0.25, 0.5, 0.75].map((t) => bezier(curve, t)))
        .find((point) => stage.getIntersection({ x: stage.x() + point.x * stage.scaleX(), y: stage.y() + point.y * stage.scaleY() })?.id() === wire.id());
      candidates.push({ id: wire.id(), curves, ...(arrow ? { arrow } : {}), color: wire.stroke(), ...(hitPoint ? { hitPoint } : {}) });
    }
    const byTerminals = (from: Pt, to: Pt) => {
      const match = candidates.find((candidate) => candidate.curves.length > 0
        && distance(candidate.curves[0]!.start, from) < 0.1 && distance(candidate.curves.at(-1)!.end, to) < 0.1);
      if (!match) throw new Error(`No drawn directed wire from ${from.x},${from.y} to ${to.x},${to.y}`);
      return match;
    };
    const layers = [...stage.getContent().querySelectorAll('canvas')];
    const [wireLayer, cardLayer] = stage.getLayers();
    if (layers.length !== 2 || wireLayer?.name() !== 'wires' || cardLayer?.name() !== 'cards'
      || layers[0] !== wireLayer.getNativeCanvasElement() || layers[1] !== cardLayer.getNativeCanvasElement()) {
      throw new Error('Expected visible wire canvas followed by visible card canvas in DOM paint order');
    }
    const firstLayer = layers[0];
    const bounds = firstLayer.getBoundingClientRect();
    for (const layer of layers) {
      const box = layer.getBoundingClientRect();
      const style = getComputedStyle(layer);
      if (style.visibility !== 'visible' || style.display === 'none' || style.opacity !== '1' || !box.width || !box.height
        || box.x !== bounds.x || box.y !== bounds.y || box.width !== bounds.width || box.height !== bounds.height
        || layer.width !== firstLayer.width || layer.height !== firstLayer.height) {
        throw new Error('The two scene canvases must be visible and share the same display and bitmap bounds');
      }
    }
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Pt): Pt => {
      const projected = transform.point(point);
      return { x: bounds.left + projected.x * bounds.width / stage.width(), y: bounds.top + projected.y * bounds.height / stage.height() };
    };
    const rectangle = (owner: Shape) => {
      const body = owner.find('Rect')[0]!;
      const worldMin = body.getAbsolutePosition(stage);
      const worldMax = { x: worldMin.x + body.width(), y: worldMin.y + body.height() };
      return { worldMin, worldMax, screenMin: screen(worldMin), screenMax: screen(worldMax) };
    };
    const rectangles = { frontend: rectangle(frontend), example2: rectangle(example2) };
    const composite = document.createElement('canvas');
    composite.width = firstLayer.width;
    composite.height = firstLayer.height;
    const context = composite.getContext('2d', { willReadFrequently: true });
    const wireContext = firstLayer.getContext('2d');
    const cardContext = layers[1].getContext('2d');
    if (!context || !wireContext || !cardContext) throw new Error('Canvas compositing context is unavailable');
    // Preserve browser layer order. Both canvases are visible: wires first,
    // then opaque cards/sockets that can occlude a bad route.
    for (const layer of layers) context.drawImage(layer, 0, 0);
    const sample = (point: Pt, expectedColor: string) => {
      const screenPoint = screen(point);
      const pixelX = Math.round((screenPoint.x - bounds.left) * composite.width / bounds.width);
      const pixelY = Math.round((screenPoint.y - bounds.top) * composite.height / bounds.height);
      const match = expectedColor.match(/\d+/g)?.map(Number);
      if (!match || match.length < 3) throw new Error(`Cannot parse rendered color ${expectedColor}`);
      if (match.slice(0, 3).every((channel) => channel > 245)) throw new Error('Refusing white card-fill color as wire-ink evidence');
      const inkHits = (layer: CanvasRenderingContext2D) => {
        const data = layer.getImageData(pixelX - 3, pixelY - 3, 7, 7).data;
        let hits = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! > 0 && Math.abs(data[i]! - match[0]!) < 30 && Math.abs(data[i + 1]! - match[1]!) < 30 && Math.abs(data[i + 2]! - match[2]!) < 30) hits += 1;
        }
        return hits;
      };
      const hits = inkHits(context);
      // Wire-only ink is diagnostic, never a substitute for composited ink.
      return { hits, screenPoint, ...(hits ? {} : {
        worldPoint: point, bitmapPoint: { x: pixelX, y: pixelY }, wireLayerHits: inkHits(wireContext),
        cardPixel: Array.from(cardContext.getImageData(pixelX, pixelY, 1, 1).data)
      }) };
    };
    const preset = byTerminals(feAction.point, exPower.point);
    const logLevel = byTerminals(exLogLevel.point, feLocalPreset.point);
    if (!preset.hitPoint || !logLevel.hitPoint) throw new Error('No physically exposed hit point for both reciprocal action wires');
    const evidence = (wire: typeof preset, source: ReturnType<typeof endpoint>, target: ReturnType<typeof endpoint>) => {
      const curvePoint = (curve: typeof wire.curves[number], t: number) => {
        const u = 1 - t;
        return { x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y };
      };
      // Sample inside each segment, away from both socket/arrow joins. The
      // second visible canvas contains nodes/cards and is composited above
      // these wires, so a hidden route segment fails the pixel check.
      const pathSamples = wire.curves.flatMap((curve) => [0.15, 0.35, 0.5, 0.65, 0.85].map((t) => curvePoint(curve, t)));
      const checks = pathSamples.map((point) => sample(point, wire.color));
      const arrow = wire.arrow?.reduce((sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3 }), { x: 0, y: 0 });
      const arrowPixels = arrow ? sample(arrow, wire.color) : { hits: 0, screenPoint: screen(wire.curves.at(-1)!.end) };
      const middleCurve = wire.curves[Math.floor(wire.curves.length / 2)]!;
      const socketPixels = (item: ReturnType<typeof endpoint>) => [
        sample({ x: item.point.x + 3.5, y: item.point.y }, item.socket.stroke),
        sample({ x: item.point.x - 3.5, y: item.point.y }, item.socket.stroke),
        sample({ x: item.point.x, y: item.point.y + 3.5 }, item.socket.stroke),
        sample({ x: item.point.x, y: item.point.y - 3.5 }, item.socket.stroke)
      ];
      return {
        curves: wire.curves, checks, arrowPixels, midpoint: screen(curvePoint(middleCurve, 0.5)), arrow: arrowPixels.screenPoint,
        sourceSocketPixels: socketPixels(source),
        targetSocketPixels: socketPixels(target)
      };
    };
    const style = getComputedStyle(document.documentElement);
    const tokens = (name: string, fallback: string) => style.getPropertyValue(`--nodel-${name}`).trim() || fallback;
    return {
      cards: { frontend: rectangles.frontend.screenMin, example2: rectangles.example2.screenMin, scale: stage.scaleX(), rectangles },
      wires: { preset: { id: preset.id, color: preset.color, source: feAction, target: exPower, clickPoint: screen(preset.hitPoint), ...evidence(preset, feAction, exPower) }, logLevel: { id: logLevel.id, color: logLevel.color, source: exLogLevel, target: feLocalPreset, clickPoint: screen(logLevel.hitPoint), ...evidence(logLevel, exLogLevel, feLocalPreset) } },
      bindingKind: 'action',
      colors: {
        accent: `rgb(${tokens('accent', '40 115 200')})`,
        action: `rgb(${tokens('topology-action', '37 99 235')})`,
        actionStrong: `rgb(${tokens('topology-action-strong', '29 78 216')})`,
        surface: `rgb(${tokens('surface', '255 255 255')})`
      }, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    };
  });

  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const initial = await inspect();
  const screenshot = (state: string) => page.screenshot({ path: test.info().outputPath(`reciprocal-actions-${state}.png`), animations: 'disabled' });
  expect(initial.cards.scale).toBe(1); // One physical pixel is one world pixel in this fixture.
  expect(initial.wires.preset.id).not.toBe(initial.wires.logLevel.id);
  expect(initial.wires.preset.source.label).toBe('Preset');
  expect(initial.wires.preset.source.side).toBe('right');
  expect(initial.wires.preset.target.label).toBe('power');
  expect(initial.wires.preset.target.side).toBe('left');
  expect(initial.wires.logLevel.source.label).toBe('LogLevel');
  expect(initial.wires.logLevel.source.side).toBe('right');
  expect(initial.wires.logLevel.target.label).toBe('Preset');
  expect(initial.wires.logLevel.target.side).toBe('left');
  expect(initial.wires.preset.source.label).toBe(initial.wires.logLevel.target.label);
  expect(initial.wires.preset.source.socket.id).not.toBe(initial.wires.logLevel.target.socket.id);
  for (const wire of Object.values(initial.wires)) {
    expect(wire.id).toMatch(/^e-(?:[0-9a-f]{4})+$/);
    expect(wire.id.length % 2).toBe(0);
  }
  const width = initial.cards.rectangles.frontend.worldMax.x - initial.cards.rectangles.frontend.worldMin.x;
  const centerX = width / 2;
  const headerY = 24;
  // Move one card down first. For both horizontal drags, the cards stay
  // physically disjoint even when their X intervals completely overlap.
  await page.mouse.move(initial.cards.frontend.x + centerX, initial.cards.frontend.y + headerY);
  await page.mouse.down();
  await page.mouse.move(initial.cards.frontend.x + centerX, initial.cards.example2.y + headerY + 140, { steps: 8 });
  await page.mouse.up();
  await frame();
  const before = await inspect();
  await screenshot('before');
  expect(before.cards.frontend.y - before.cards.example2.y).toBe(140);
  expect(before.cards.rectangles.example2.worldMax.y - before.cards.rectangles.example2.worldMin.y).toBe(138);
  expect(before.cards.rectangles.frontend.worldMin.y - before.cards.rectangles.example2.worldMax.y, 'actual clearance after reserving the overflow rail').toBe(2);
  const assertDirect = (key: 'preset' | 'logLevel', scene: typeof before) => {
    const wire = scene.wires[key];
    expect(wire.curves, `${key} is one compact direct cubic`).toHaveLength(1);
    const curve = wire.curves[0]!;
    expect(curve.start).toEqual(wire.source.point);
    expect(curve.end).toEqual(wire.target.point);
    expect(curve.start.x).toBeLessThan(curve.end.x);
    expect(curve.control1.x).toBeGreaterThanOrEqual(curve.start.x);
    expect(curve.control1.x).toBeLessThanOrEqual(curve.control2.x);
    expect(curve.control2.x).toBeLessThanOrEqual(curve.end.x);
    expect(curve.control1.y).toBe(curve.start.y);
    expect(curve.control2.y).toBe(curve.end.y);
    // With horizontal endpoint tangents this compact cubic stays between the
    // real socket rows; it cannot loop around either card or reverse in X.
    let previousX = curve.start.x;
    for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const u = 1 - t;
      const x = u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x;
      const y = u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y;
      expect(x, `${key} is monotone at t=${t}`).toBeGreaterThan(previousX);
      expect(x, `${key} is monotone at t=${t}`).toBeLessThan(curve.end.x);
      expect(y, `${key} remains within the two projected socket rows`).toBeGreaterThanOrEqual(Math.min(curve.start.y, curve.end.y));
      expect(y, `${key} remains within the two projected socket rows`).toBeLessThanOrEqual(Math.max(curve.start.y, curve.end.y));
      previousX = x;
    }
  };
  const assertExterior = (key: 'preset' | 'logLevel', scene: typeof before) => {
    const wire = scene.wires[key];
    expect(wire.curves.length, `${key} routes outside the opposing cards`).toBeGreaterThan(1);
    expect(wire.curves[0]!.start).toEqual(wire.source.point);
    expect(wire.curves.at(-1)!.end).toEqual(wire.target.point);
    const maxDetour = Math.max(...wire.curves.flatMap((curve) => [curve.control1.y, curve.control2.y]))
      - Math.min(...wire.curves.flatMap((curve) => [curve.control1.y, curve.control2.y]));
    expect(maxDetour, `${key} has a visibly exterior rail`).toBeGreaterThan(30);
  };
  const initialDirectKey = before.cards.example2.x < before.cards.frontend.x ? 'logLevel' : 'preset';
  const initialExteriorKey = initialDirectKey === 'logLevel' ? 'preset' : 'logLevel';
  assertDirect(initialDirectKey, before);
  assertExterior(initialExteriorKey, before);
  const assertPainted = (scene: typeof before) => {
    for (const key of ['preset', 'logLevel'] as const) {
      const wire = scene.wires[key];
      expect(wire.id).toBe(before.wires[key].id);
      const missingInk = wire.checks.filter((check) => check.hits === 0);
      expect(missingInk, `${key} is painted along the route; missing samples: ${JSON.stringify(missingInk)}`).toHaveLength(0);
      expect(wire.arrowPixels.hits, `${key} arrowhead is painted`).toBeGreaterThan(0);
      expect(wire.sourceSocketPixels.some((sample) => sample.hits > 0)).toBe(true);
      expect(wire.targetSocketPixels.some((sample) => sample.hits > 0)).toBe(true);
    }
    expect(Math.abs(scene.wires.preset.midpoint.y - scene.wires.logLevel.midpoint.y)).toBeGreaterThan(14);
  };
  const visibilitySamples: Array<typeof before> = [before];
  let capturedOverlap = false;

  const drag = async (start: typeof before, offsets: number[]) => {
    const y = start.cards.frontend.y + headerY;
    await page.mouse.move(start.cards.frontend.x + centerX, y);
    await page.mouse.down();
    let previous = start;
    for (const x of offsets) {
      const previousOffset = previous.cards.frontend.x - previous.cards.example2.x;
      await page.mouse.move(before.cards.example2.x + x + centerX, y, { steps: Math.max(1, Math.ceil(Math.abs(previousOffset - x) / 40)) });
      await frame();
      const current = await inspect();
      expect(current.cards.frontend.x - current.cards.example2.x).toBe(x);
      visibilitySamples.push(current);
      if (x === 0 && !capturedOverlap) {
        await screenshot('during-overlap');
        capturedOverlap = true;
      }
      if (Math.abs(x - previousOffset) === 1) {
        for (const key of ['preset', 'logLevel'] as const) {
          const a = previous.wires[key].midpoint;
          const b = current.wires[key].midpoint;
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${key} midpoint at ${previousOffset}→${x}`).toBeLessThanOrEqual(1.01);
        }
      }
      previous = current;
    }
    await page.mouse.up();
    return previous;
  };

  const startsRight = before.cards.frontend.x > before.cards.example2.x;
  const gap40 = await drag(before, [startsRight ? 258 : -258]);
  const spatiallyForwardKey = startsRight ? 'logLevel' : 'preset';
  const forwardWire = gap40.wires[spatiallyForwardKey];
  expect(Math.abs(forwardWire.target.point.x - forwardWire.source.point.x), 'projected output/input sockets have a 40px clear gap').toBe(40);
  expect(Math.abs(gap40.cards.frontend.y - gap40.cards.example2.y)).toBe(140);
  await screenshot('gap-40');
  assertDirect(spatiallyForwardKey, gap40);
  assertExterior(spatiallyForwardKey === 'logLevel' ? 'preset' : 'logLevel', gap40);
  const thresholds = [218, 217, 0, -217, -218];
  const crossed = await drag(gap40, startsRight ? [...thresholds, -290] : [...thresholds.slice().reverse(), 290]);
  const swappedDirectKey = crossed.cards.example2.x < crossed.cards.frontend.x ? 'logLevel' : 'preset';
  expect(swappedDirectKey, 'crossing the cards swaps which directed route is direct').not.toBe(initialDirectKey);
  assertDirect(swappedDirectKey, crossed);
  assertExterior(swappedDirectKey === 'logLevel' ? 'preset' : 'logLevel', crossed);
  await screenshot('after');
  // Cross back over both branch boundaries, then park with overlapping X
  // ranges so the two rails must both be available in the Konva hit canvas.
  const returned = await drag(crossed, startsRight ? [...thresholds.slice().reverse(), 290] : [...thresholds, -290]);
  const overlapped = await drag(returned, [120]);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const stageBounds = await page.locator('.canvas-stage').boundingBox();
  if (!stageBounds) throw new Error('Canvas stage has no bounds for pan interaction');
  await page.mouse.move(stageBounds.x + 18, stageBounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(stageBounds.x + 48, stageBounds.y + 42, { steps: 3 });
  await page.mouse.up();
  await frame();
  const zoomedAndPanned = await inspect();
  expect(zoomedAndPanned.cards.scale).toBeGreaterThan(1);
  expect(zoomedAndPanned.wires.preset.midpoint).not.toEqual(overlapped.wires.preset.midpoint);
  for (const key of ['preset', 'logLevel'] as const) {
    const chosen = zoomedAndPanned.wires[key];
    const other = key === 'preset' ? 'logLevel' : 'preset';
    await page.mouse.click(chosen.clickPoint.x, chosen.clickPoint.y);
    await frame();
    const selected = await inspect();
    visibilitySamples.push(selected);
    expect(selected.bindingKind).toBe('action');
    expect(selected.wires[key].color).toBe(selected.colors.action);
    expect(selected.wires[other].color).toBe(selected.colors.action);
    for (const endpoint of ['source', 'target'] as const) {
      const selectedSocket = selected.wires[key][endpoint].socket;
      const otherSocket = selected.wires[other][endpoint].socket;
      expect(selectedSocket.stroke).toBe(selected.colors.action);
      expect(selectedSocket.fill).toBe(endpoint === 'target' ? selected.colors.action : selected.colors.surface);
      expect(otherSocket.stroke).toBe(selected.colors.action);
      expect(otherSocket.fill).toBe(endpoint === 'target' ? selected.colors.action : selected.colors.surface);
    }
    await screenshot(`selected-${key}`);
  }
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
      { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
      { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
  // Run the composited-pixel assertions after captures and physical clicks so
  // a failure still leaves before/gap/after evidence for visual diagnosis.
  for (const key of ['preset', 'logLevel'] as const) {
    const missingInk = gap40.wires[key].checks.filter((check) => check.hits === 0);
    expect(missingInk, `${key} stays visible along every segment at dy=140 / port gap=40; cards: ${JSON.stringify(gap40.cards.rectangles)}; missing: ${JSON.stringify(missingInk)}`).toHaveLength(0);
  }
  for (const scene of visibilitySamples) assertPainted(scene);
});

test('event subscribers select only their exact typed binding through real exposed wire hit points', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example 1': {}, 'Example 2': {}, 'Example Frontend': {} } }));
    } else if (request.pathname === '/nodes/Example1/REST/remote') {
      await route.fulfill(jsonResponse({ events: { Gate2Input1: { node: 'Example 2', event: 'LogLevel' } } }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({ events: {
        Preset: { node: 'Example 2', event: 'LogLevel' },
        Switch: { node: 'Example 1', event: 'Gate1Output' }
      } }));
    } else {
      throw new Error(`Unexpected event-selection fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('3 nodes');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);

  type Point = { x: number; y: number };
  type Endpoint = { node: string; port: string; kind: string; side: 'left' | 'right'; point: Point; fill: string; stroke: string; connectionSelected: boolean };
  type Curve = { start: Point; control1: Point; control2: Point; end: Point };
  type Wire = { id: string; kind: string; owner: string; from: Endpoint; to: Endpoint; color: string; width: number; curves: Curve[]; painted?: number[]; candidates?: Point[]; click?: Point; hit?: string };
  type Scene = { wires: Record<'upstream' | 'preset' | 'switch', Wire>; sockets: Endpoint[]; cardIds: Record<string, string>; example1Bounds: { x: number; y: number; right: number; bottom: number }; example1Header: Point; colors: { event: string; strong: string; surface: string } };
  const inspect = (probeHits = false): Promise<Scene> => page.evaluate((probe) => {
    type Pt = { x: number; y: number };
    type Shape = {
       id(): string; name(): string; x(): number; y(): number; text(): string; align(): string; fill(): string; stroke(): string; strokeWidth(): number; getAttr(name: string): unknown;
      getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
       getHitFunc(): (context: {
         beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
         lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillStyle: string; strokeStyle: string; lineWidth: number; strokeShape(shape: Shape): void; fillShape(shape: Shape): void;
      }, shape: Shape) => void;
    };
    type Stage = Shape & {
      getContent(): HTMLElement; getAbsoluteTransform(): { point(point: Pt): Pt }; scaleX(): number; width(): number; height(): number;
      getIntersection(point: Pt): Shape | null;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const cards = stage.find('.topology-card');
    const cardName = (card: Shape) => card.find('Text').find((text) => text.align() === 'left' && text.getAbsolutePosition(stage).y < card.getAbsolutePosition(stage).y + 40)?.text();
    const cardIds = Object.fromEntries(cards.map((card) => [cardName(card) ?? '<unlabelled>', card.id()]));
    const example1Card = cards.find((card) => cardName(card) === 'Example 1');
    const example1Body = example1Card?.find('Rect').find((rect) => rect.width() > 100);
    if (!example1Card || !example1Body) throw new Error('Example 1 body bounds are unavailable');
    const example1Origin = example1Body.getAbsolutePosition(stage);
    const headerWorld = stage.getAbsoluteTransform().point({ x: example1Origin.x + 80, y: example1Origin.y + 20 });
    const contentRect = stage.getContent().getBoundingClientRect();
    const example1Header = { x: contentRect.left + headerWorld.x * contentRect.width / stage.width(), y: contentRect.top + headerWorld.y * contentRect.height / stage.height() };
    const sockets: Endpoint[] = cards.flatMap((card) => {
      const owner = cardName(card);
      if (!owner) return [];
      const labels = card.find('Text');
      return card.find('Circle').filter((socket) => socket.name().startsWith('socket-')).map((socket) => {
        const side = socket.x() === 0 ? 'left' : 'right';
        const label = labels.find((text) => text.align() === side && Math.abs(text.y() + 7 - socket.y()) < 0.1);
        return { node: owner, port: label?.text() ?? '<unlabelled>', kind: String(socket.getAttr('localKind') ?? ''), side,
           point: socket.getAbsolutePosition(stage), fill: socket.fill(), stroke: socket.stroke(), connectionSelected: Boolean(socket.getAttr('connectionSelected')) };
      });
    });
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const endpointFor = (point: Pt) => {
      const match = sockets.find((socket) => distance(socket.point, point) < 0.1);
      if (!match) throw new Error(`Wire endpoint ${point.x},${point.y} does not resolve to a rendered socket`);
      return match;
    };
    const rect = stage.getContent().getBoundingClientRect();
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Pt) => {
      const scaled = transform.point(point);
      return { x: rect.left + scaled.x * rect.width / stage.width(), y: rect.top + scaled.y * rect.height / stage.height() };
    };
    const wires: Wire[] = stage.find('.topology-wire').filter((wire) => wire.getAttr('bindingKind') === 'event').map((wire) => {
      const curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }> = [];
      let start: Pt | undefined;
      let color = '';
      let width = 0;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { start = undefined; },
        moveTo(x: number, y: number) { start = { x, y }; },
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { if (start) curves.push({ start, control1: { x: a, y: b }, control2: { x: c, y: d }, end: { x, y } }); },
        lineTo() {}, closePath() {}, fill() {},
        stroke() { color = wire.stroke(); width = wire.strokeWidth(); },
        strokeShape() { color = wire.stroke(); width = wire.strokeWidth(); }, fillShape() {}
      };
      wire.getHitFunc().call(wire, context, wire);
      if (curves.length === 0) throw new Error(`Event wire ${wire.id()} rendered no curves`);
      const candidates = curves.flatMap((curve) => [0.2, 0.4, 0.6, 0.8].map((t) => {
        const u = 1 - t;
        return screen({
          x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        });
      }));
      return { id: wire.id(), kind: 'event', owner: String(wire.getAttr('ownerId')), from: endpointFor(curves[0]!.start),
        to: endpointFor(curves.at(-1)!.end), color, width, curves, candidates };
    });
    const by = (source: string, sourcePort: string, target: string, targetPort: string) => {
      const matches = wires.filter((wire) => wire.from.node === source && wire.from.port === sourcePort && wire.to.node === target && wire.to.port === targetPort);
      if (matches.length !== 1) throw new Error(`Expected one event wire ${source}.${sourcePort} → ${target}.${targetPort}, got ${matches.length}`);
      return matches[0]!;
    };
    const selected = {
       upstream: by('Example 2', 'LogLevel', 'Example 1', 'Gate2Input1'),
       preset: by('Example 2', 'LogLevel', 'Example Frontend', 'Preset'),
       switch: by('Example 1', 'Gate1Output', 'Example Frontend', 'Switch')
    };
    if (wires.length !== 3 || new Set(Object.values(selected).map((wire) => wire.id)).size !== 3) {
      throw new Error(`Expected exactly three uniquely identified event bindings, got ${wires.length}`);
    }
    const content = stage.getContent();
    const [wireCanvas, cardCanvas] = [...content.querySelectorAll('canvas')];
    if (!wireCanvas || !cardCanvas) throw new Error('Expected both composited scene canvases');
    const composite = document.createElement('canvas');
    composite.width = wireCanvas.width;
    composite.height = wireCanvas.height;
    const compositeContext = composite.getContext('2d', { willReadFrequently: true });
    const wireContext = wireCanvas.getContext('2d', { willReadFrequently: true });
    if (!compositeContext || !wireContext) throw new Error('Canvas pixel inspection unavailable');
    compositeContext.drawImage(wireCanvas, 0, 0);
    compositeContext.drawImage(cardCanvas, 0, 0);
    const canvasBounds = wireCanvas.getBoundingClientRect();
    for (const wire of wires) {
      const rgb = wire.color.match(/\d+/g)?.map(Number);
      if (!rgb || rgb.length < 3) throw new Error(`Cannot read wire color ${wire.color}`);
      wire.painted = wire.curves.flatMap((curve) => [0.2, 0.5, 0.8].map((t) => {
        const u = 1 - t;
        const point = screen({
          x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        });
        const x = Math.round((point.x - canvasBounds.left) * composite.width / canvasBounds.width);
        const y = Math.round((point.y - canvasBounds.top) * composite.height / canvasBounds.height);
        const pixels = compositeContext.getImageData(x - 2, y - 2, 5, 5).data;
        let hits = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3]! > 0 && Math.abs(pixels[index]! - rgb[0]!) < 30 && Math.abs(pixels[index + 1]! - rgb[1]!) < 30 && Math.abs(pixels[index + 2]! - rgb[2]!) < 30) hits += 1;
        }
        return hits;
      }));
    }
    if (!probe) for (const wire of Object.values(selected)) delete wire.candidates;
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(`--nodel-${name}`).trim() || fallback;
    return { wires: selected, sockets, cardIds,
      example1Bounds: { x: example1Origin.x, y: example1Origin.y, right: example1Origin.x + example1Body.width(), bottom: example1Origin.y + example1Body.height() }, example1Header, colors: {
      event: `rgb(${token('topology-event', '13 148 136')})`, strong: `rgb(${token('topology-event-strong', '15 118 110')})`,
      surface: `rgb(${token('surface', '255 255 255')})`
    } };
  }, probeHits);

  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const initial = await inspect(true);
  await mkdir(artifactDir, { recursive: true });
  const initialScreenshot = resolve(artifactDir, 'local-mode-auto-initial.png');
  await page.screenshot({ path: initialScreenshot, animations: 'disabled' });
  expect(initial.wires.upstream.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', side: 'right' });
  expect(initial.wires.upstream.to).toMatchObject({ node: 'Example 1', port: 'Gate2Input1', side: 'left' });
  expect(initial.wires.preset.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', side: 'right' });
  expect(initial.wires.preset.to).toMatchObject({ node: 'Example Frontend', port: 'Preset', side: 'left' });
  expect(initial.wires.switch.from).toMatchObject({ node: 'Example 1', port: 'Gate1Output', side: 'right' });
  expect(initial.wires.switch.to).toMatchObject({ node: 'Example Frontend', port: 'Switch', side: 'left' });
  expect(new Set(Object.values(initial.wires).map((wire) => wire.id)).size).toBe(3);
  for (const wire of Object.values(initial.wires)) {
    for (const candidate of wire.candidates ?? []) {
      await page.mouse.move(candidate.x, candidate.y);
      const hit = await page.evaluate(() => {
        type HitShape = { id(): string };
        type HitStage = { getPointerPosition(): Point | null; getIntersection(point: Point): HitShape | null };
        const stage = (window as Window & { Konva?: { stages?: HitStage[] } }).Konva?.stages?.[0];
        const pointer = stage?.getPointerPosition();
        return pointer ? stage?.getIntersection(pointer)?.id() : undefined;
      });
      if (hit === wire.id) { wire.click = candidate; wire.hit = hit; break; }
    }
    expect(wire.hit, `${wire.id} has a unique visible click point whose native hit is that exact edge`).toBe(wire.id);
  }
  expect(initial.wires.upstream.owner).toBe(initial.cardIds['Example 1']);
  expect(initial.wires.preset.owner).toBe(initial.cardIds['Example Frontend']);
  expect(initial.wires.switch.owner).toBe(initial.cardIds['Example Frontend']);
  expect(initial.wires.upstream.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', kind: 'local-event', side: 'right' });
  expect(initial.wires.upstream.to).toMatchObject({ node: 'Example 1', port: 'Gate2Input1', kind: 'remote-event', side: 'left' });
  expect(initial.wires.preset.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', kind: 'local-event', side: 'right' });
  expect(initial.wires.preset.to).toMatchObject({ node: 'Example Frontend', port: 'Preset', kind: 'remote-event', side: 'left' });
  expect(initial.wires.switch.from).toMatchObject({ node: 'Example 1', port: 'Gate1Output', kind: 'local-event', side: 'right' });
  expect(initial.wires.switch.to).toMatchObject({ node: 'Example Frontend', port: 'Switch', kind: 'remote-event', side: 'left' });
  for (const wire of Object.values(initial.wires)) {
    expect(wire.id).not.toBe('');
    expect(wire.hit).toBe(wire.id);
    expect(wire.color).toBe(initial.colors.event);
    expect(wire.width).toBe(1.6);
  }
  expect(initial.wires.preset.from.point).toEqual(initial.wires.upstream.from.point);
  expect(initial.wires.preset.to.point).not.toEqual(initial.wires.upstream.to.point);
  for (const [key, wire] of Object.entries(initial.wires)) {
    expect(wire.painted, `${key} remains visible after cards composite above wires`).toBeDefined();
    expect(wire.painted!.every((hits) => hits > 0), `${key} visible composite pixels ${JSON.stringify(wire.painted)}`).toBe(true);
  }
  const bypass = initial.wires.preset;
  for (const curve of bypass.curves) {
    for (const t of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]) {
      const u = 1 - t;
      const x = u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x;
      const y = u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y;
      const bounds = initial.example1Bounds;
      expect(x < bounds.x - 16 || x > bounds.right + 16 || y < bounds.y - 16 || y > bounds.bottom + 16,
        `Preset bypass stays outside Example 1 padded body at t=${t}: ${x},${y} vs ${JSON.stringify(bounds)}`).toBe(true);
    }
  }

  const assertSelection = (scene: Scene, selected?: keyof Scene['wires']) => {
    const selectedWire = selected ? scene.wires[selected] : undefined;
    for (const [key, wire] of Object.entries(scene.wires) as Array<[keyof Scene['wires'], Wire]>) {
      expect(wire.color, `${key} core wire hue`).toBe(scene.colors.event);
      expect(wire.width, `${key} core stroke width`).toBe(1.6);
    }
    const activeSocketIds = new Set(selectedWire ? [
      `${selectedWire.from.node}.${selectedWire.from.port}`,
      `${selectedWire.to.node}.${selectedWire.to.port}`
    ] : []);
    for (const socket of scene.sockets) {
      const active = activeSocketIds.has(`${socket.node}.${socket.port}`);
      expect(socket.stroke, `${socket.node}.${socket.port} core stroke`).toBe(scene.colors.event);
      expect(socket.connectionSelected, `${socket.node}.${socket.port} selection state`).toBe(active);
      expect(socket.fill, `${socket.node}.${socket.port} endpoint role`).toBe(socket.kind === 'local-event' ? scene.colors.event : scene.colors.surface);
    }
    expect(scene.sockets.filter((socket) => activeSocketIds.has(`${socket.node}.${socket.port}`))).toHaveLength(selected ? 2 : 0);
    if (selected) {
      expect(selectedWire?.from.fill).toBe(scene.colors.event);
      expect(selectedWire?.to.fill).toBe(scene.colors.surface);
    }
  };
  assertSelection(initial);
  await mkdir(artifactDir, { recursive: true });
  for (const key of ['upstream', 'preset', 'switch'] as const) {
    const wire = initial.wires[key];
    if (!wire.click) throw new Error(`Missing trusted click point for ${key}`);
    await page.mouse.click(wire.click.x, wire.click.y);
    await frame();
    const selected = await inspect();
    expect(selected.wires[key].color, `${key} retains its event core hue when selected`).toBe(selected.colors.event);
    assertSelection(selected, key);
    await page.screenshot({ path: resolve(artifactDir, `event-selected-${key}.png`), animations: 'disabled' });
  }
  const bypassBeforeDrag = JSON.stringify((await inspect()).wires.preset.curves);
  await page.mouse.move(initial.example1Header.x, initial.example1Header.y);
  await page.mouse.down();
  await page.mouse.move(initial.example1Header.x + 35, initial.example1Header.y + 25, { steps: 4 });
  await page.mouse.up();
  await frame();
  const afterExample1Drag = await inspect();
  expect(JSON.stringify(afterExample1Drag.wires.preset.curves), 'the unrelated Example 2→Frontend bypass does not continuously reroute').toBe(bypassBeforeDrag);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Example1/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
});

for (const returnCount of [2, 3, 4]) test(`${returnCount} same-direction returns keep separate painted rails and independent physical selection`, async ({ page }) => {
  const returnSpecs = [
    { key: 'alpha', output: 'Return Alpha', input: 'Return Input Alpha' },
    { key: 'bravo', output: 'Return Bravo', input: 'Return Input Bravo' },
    { key: 'charlie', output: 'Return Charlie', input: 'Return Input Charlie' },
    { key: 'delta', output: 'Return Delta', input: 'Return Input Delta' }
  ].slice(0, returnCount);
  const returns = returnSpecs.map(({ key }) => key);
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Source: {}, Target: {} } }));
    } else if (request.pathname === '/nodes/Source/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: { Forward: { node: 'Target', action: 'Forward Input' } }
      }));
    } else if (request.pathname === '/nodes/Target/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: Object.fromEntries(returnSpecs.map(({ output, input }) => [output, { node: 'Source', action: input }]))
      }));
    } else {
      throw new Error(`Unexpected parallel-return fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  type Point = { x: number; y: number };
  type RouteScene = {
    id: string;
    source: { label: string; point: Point; socket: { id: string; fill: string; stroke: string } };
    target: { label: string; point: Point; socket: { id: string; fill: string; stroke: string } };
    curves: Array<{ start: Point; control1: Point; control2: Point; end: Point }>;
    color: string;
    arrowColor: string;
    rail: { start: Point; end: Point; midpoint: Point; pixels: number; leftLeg: Point; rightLeg: Point };
  };
   type Scene = { scale: number; accent: string; routes: Record<string, RouteScene>; socketStates: Record<string, { fill: string; stroke: string; connectionSelected: boolean }> };
  const inspect = (): Promise<Scene> => page.evaluate((returnSpecs): Scene => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; height(): number; text(): string; align(): string;
      fill(): string; stroke(): string; getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
       getHitFunc(): (context: {
         beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
         lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillShape(shape: Shape): void; strokeShape(shape: Shape): void; fillStyle: string; strokeStyle: string; lineWidth: number;
      }, shape: Shape) => void;
    };
    type Layer = { name(): string; getNativeCanvasElement(): HTMLCanvasElement };
    type Stage = Shape & {
      getContent(): HTMLElement; getAbsoluteTransform(): { point(point: Pt): Pt }; scaleX(): number; width(): number; height(): number;
      getLayers(): Layer[]; container(): HTMLElement;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const sourceCard = card('Source');
    const targetCard = card('Target');
    if (!sourceCard || !targetCard) throw new Error('Parallel-return fixture cards were not rendered');
    const endpoint = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === side);
      if (!text) throw new Error(`Missing ${side} ${label} endpoint label`);
      const body = owner.find('Rect').find((item) => item.width() > 100);
      const socket = owner.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : body?.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing ${side} ${label} socket`);
      return { label, point: socket.getAbsolutePosition(stage), socket: { id: socket.name(), fill: socket.fill(), stroke: socket.stroke() } };
    };
    const expected: Record<string, { source: ReturnType<typeof endpoint>; target: ReturnType<typeof endpoint> }> = {
      forward: { source: endpoint(sourceCard, 'Forward', 'right'), target: endpoint(targetCard, 'Forward Input', 'left') }
    };
    for (const { key, output, input } of returnSpecs) expected[key] = {
      source: endpoint(targetCard, output, 'right'), target: endpoint(sourceCard, input, 'left')
    };
    const layers = [...stage.getContent().querySelectorAll('canvas')];
    const [wireLayer, cardLayer] = stage.getLayers();
    if (layers.length !== 2 || wireLayer?.name() !== 'wires' || cardLayer?.name() !== 'cards'
      || layers[0] !== wireLayer.getNativeCanvasElement() || layers[1] !== cardLayer.getNativeCanvasElement()) {
      throw new Error('Expected visible wire canvas followed by visible card canvas in DOM paint order');
    }
    const firstLayer = layers[0];
    const bounds = firstLayer.getBoundingClientRect();
    for (const layer of layers) {
      const box = layer.getBoundingClientRect();
      const style = getComputedStyle(layer);
      if (style.visibility !== 'visible' || style.display === 'none' || style.opacity !== '1' || !box.width || !box.height
        || box.x !== bounds.x || box.y !== bounds.y || box.width !== bounds.width || box.height !== bounds.height
        || layer.width !== firstLayer.width || layer.height !== firstLayer.height) throw new Error('Visible scene layers do not share identical bounds');
    }
    const composite = document.createElement('canvas');
    composite.width = firstLayer.width;
    composite.height = firstLayer.height;
    const pixels = composite.getContext('2d', { willReadFrequently: true });
    if (!pixels) throw new Error('Composited canvas readback is unavailable');
    for (const layer of layers) pixels.drawImage(layer, 0, 0);
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Pt): Pt => {
      const projected = transform.point(point);
      return { x: bounds.left + projected.x * bounds.width / stage.width(), y: bounds.top + projected.y * bounds.height / stage.height() };
    };
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(`--nodel-${name}`).trim() || fallback;
    const accent = `rgb(${token('accent', '40 115 200')})`;
    const action = `rgb(${token('topology-action', '37 99 235')})`;
    const actionStrong = `rgb(${token('topology-action-strong', '29 78 216')})`;
    const surface = `rgb(${token('surface', '255 255 255')})`;
    const routes: Record<string, RouteScene> = {};
    const used = new Set<string>();
    for (const [key, terminals] of Object.entries(expected)) {
      const candidates: Array<{ wire: Shape; curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }>; color: string; arrowColor: string }> = [];
      for (const wire of stage.find('.topology-wire')) {
        const curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }> = [];
        let current: { start: Pt; control1?: Pt; control2?: Pt; end?: Pt } | undefined;
        let color = '';
        let arrowColor = '';
        const context = {
          strokeStyle: '', fillStyle: '', lineWidth: 0,
          beginPath() { current = undefined; },
          moveTo(x: number, y: number) { current = { start: { x, y } }; },
          bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
            if (current) { current.control1 = { x: a, y: b }; current.control2 = { x: c, y: d }; current.end = { x, y }; }
          },
         lineTo() {}, closePath() {}, fill() { arrowColor = wire.stroke(); },
         fillShape() { arrowColor = wire.stroke(); }, strokeShape() {
           color = wire.stroke();
           if (current?.control1 && current.control2 && current.end) curves.push({ ...current, control1: current.control1, control2: current.control2, end: current.end });
         },
         stroke() {
           color = wire.stroke();
            if (current?.control1 && current.control2 && current.end) curves.push({ ...current, control1: current.control1, control2: current.control2, end: current.end });
          }
        };
          wire.getHitFunc().call(wire, context, wire);
         if (curves.length && distance(curves[0]!.start, terminals.source.point) < 0.1 && distance(curves.at(-1)!.end, terminals.target.point) < 0.1) candidates.push({ wire, curves, color, arrowColor });
      }
      if (candidates.length !== 1 || used.has(candidates[0]!.wire.id())) throw new Error(`Expected exactly one unclaimed rendered wire for ${key}, got ${candidates.length}`);
      const candidate = candidates[0]!;
      used.add(candidate.wire.id());
       const segment = candidate.curves.reduce((longest, curve) => distance(curve.start, curve.end) > distance(longest.start, longest.end) ? curve : longest);
       const verticalLegs = candidate.curves.filter((curve) => Math.abs(curve.start.x - curve.end.x) < 0.1
         && Math.abs(curve.start.y - curve.end.y) > 20).sort((a, b) => a.start.x - b.start.x);
       const legMidpoint = (curve: typeof verticalLegs[number]) => screen({ x: curve.start.x, y: (curve.start.y + curve.end.y) / 2 });
      const midpoint = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
      const viewport = screen(midpoint);
      const pixelX = Math.round((viewport.x - bounds.left) * composite.width / bounds.width);
      const pixelY = Math.round((viewport.y - bounds.top) * composite.height / bounds.height);
      const rgb = candidate.color.match(/\d+/g)?.map(Number);
      if (!rgb || rgb.length < 3) throw new Error(`Unrecognized wire ink ${candidate.color}`);
      let painted = false;
      for (let y = -3; y <= 3; y += 1) for (let x = -3; x <= 3; x += 1) {
        const pixel = pixels.getImageData(pixelX + x, pixelY + y, 1, 1).data;
        if (pixel[3]! > 0 && rgb.slice(0, 3).every((channel, index) => Math.abs(pixel[index]! - channel) < 30)) painted = true;
      }
      routes[key] = {
         id: candidate.wire.id(), source: terminals.source, target: terminals.target, curves: candidate.curves, color: candidate.color, arrowColor: candidate.arrowColor,
         rail: { start: screen(segment.start), end: screen(segment.end), midpoint: screen(midpoint), pixels: distance(screen(segment.start), screen(segment.end)) * devicePixelRatio,
           leftLeg: verticalLegs.length >= 2 ? legMidpoint(verticalLegs[0]!) : screen(midpoint),
           rightLeg: verticalLegs.length >= 2 ? legMidpoint(verticalLegs.at(-1)!) : screen(midpoint) }
      };
      if (!painted) throw new Error(`The composited wire/card layers do not paint the ${key} rail midpoint`);
    }
     const socketStates: Record<string, { fill: string; stroke: string; connectionSelected: boolean }> = {};
     for (const cardItem of cards) for (const socket of cardItem.find('Circle').filter((item) => item.name().startsWith('socket-'))) {
       socketStates[socket.name()] = { fill: socket.fill(), stroke: socket.stroke(), connectionSelected: Boolean(socket.getAttr('connectionSelected')) };
    }
    return { scale: stage.scaleX(), accent, action, actionStrong, surface, routes, socketStates };
  }, returnSpecs);

  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const beforeMove = await inspect();
  expect(beforeMove.scale).toBe(1);
  const target = await page.evaluate(() => {
    type Shape = { text(): string; getParent(): { x(): number; y(): number } };
    type Stage = { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((shape) => shape.text() === 'Target');
    if (!title) throw new Error('Target title is unavailable');
    const group = title.getParent();
    return { x: group.x(), y: group.y() };
  });
  const sourcePosition = await page.evaluate(() => {
    type Shape = { text(): string; getParent(): { x(): number; y(): number } };
    type Stage = { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((shape) => shape.text() === 'Source');
    if (!title) throw new Error('Source title is unavailable');
    const group = title.getParent();
    return { x: group.x(), y: group.y() };
  });
  const separatedTargetX = sourcePosition.x + 80;
  const camera = await page.evaluate(() => {
    type Stage = { x(): number; y(): number; scaleX(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage camera is unavailable');
    return { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
  });
  const scale = camera.scale;
  const bounds = await page.locator('.canvas-stage').boundingBox();
  if (!bounds) throw new Error('Canvas stage has no bounds');
  const screenPoint = (point: Point) => ({ x: bounds.x + camera.x + point.x * scale, y: bounds.y + camera.y + point.y * scale });
  const targetHeader = screenPoint({ x: target.x + 100, y: target.y + 24 });
  await page.mouse.move(targetHeader.x, targetHeader.y);
  await page.mouse.down();
  await page.mouse.move(targetHeader.x + sourcePosition.x - target.x + 80, targetHeader.y + sourcePosition.y - target.y + 350, { steps: 12 });
  await page.mouse.up();
  await frame();
  const initial = await inspect();
  expect(initial.scale).toBe(1);
  for (const key of returns) {
    expect(initial.routes[key]!.rail.pixels, `${key} long rail is measured at 100%`).toBeGreaterThan(220);
  }
  const laneYs = returns.map((key) => initial.routes[key]!.rail.midpoint.y).sort((a, b) => a - b);
   for (let index = 1; index < laneYs.length; index += 1) {
    expect(laneYs[index]! - laneYs[index - 1]!, 'composited long-rail lane spacing stays usable at 100%').toBeGreaterThanOrEqual(10);
    expect(laneYs[index]! - laneYs[index - 1]!).toBeLessThanOrEqual(14);
   }
   for (const side of ['leftLeg', 'rightLeg'] as const) {
     const xs = returns.map((key) => initial.routes[key]!.rail[side].x).sort((a, b) => a - b);
     for (let index = 1; index < xs.length; index += 1) {
       expect(xs[index]! - xs[index - 1]!, `${side} rendered X lane spacing is approximately 12px`).toBeGreaterThanOrEqual(10);
       expect(xs[index]! - xs[index - 1]!).toBeLessThanOrEqual(14);
     }
   }
  expect(initial.routes.forward!.curves.length, 'reciprocal forward path is rendered as curves').toBeGreaterThan(0);
  expect(new Set(returns.map((key) => initial.routes[key]!.id)).size).toBe(returns.length);

  const dragTargetX = async (x: number) => {
    const cardPosition = await page.evaluate(() => {
      type Shape = { text(): string; getParent(): { x(): number; y(): number } };
      type Stage = { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const title = stage?.find('Text').find((shape) => shape.text() === 'Target');
      if (!title) throw new Error('Target title is unavailable during the crossing drag');
      const group = title.getParent();
      return { x: group.x(), y: group.y() };
    });
    // Move from a known point inside Target's header; x is the new card origin.
    const from = screenPoint({ x: cardPosition.x + 100, y: cardPosition.y + 24 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (x - cardPosition.x) * scale, from.y, { steps: 12 });
    await page.mouse.up();
    await frame();
  };
  await dragTargetX(sourcePosition.x - 80);
  const crossed = await inspect();
  for (const key of returns) expect(crossed.routes[key]!.id).toBe(initial.routes[key]!.id);
  await dragTargetX(separatedTargetX);
  const returned = await inspect();
  for (const key of ['forward', ...returns] as const) {
    expect(returned.routes[key]!.id).toBe(initial.routes[key]!.id);
    expect(returned.routes[key]!.curves).toEqual(initial.routes[key]!.curves);
  }

   await mkdir(artifactDir, { recursive: true });
   const screenshot = (name: string) => page.screenshot({ path: resolve(artifactDir, `parallel-return-${name}.png`), animations: 'disabled' });
   await screenshot('rails-before-selection');
   const forward = returned.routes.forward!;
   await page.mouse.click(forward.rail.midpoint.x, forward.rail.midpoint.y);
   await frame();
   const selectedForward = await inspect();
     expect(selectedForward.routes.forward!.color).toBe(selectedForward.action);
     expect(selectedForward.routes.forward!.arrowColor).toBe(selectedForward.action);
    for (const endpoint of ['source', 'target'] as const) {
      const socket = selectedForward.routes.forward![endpoint].socket;
       expect(selectedForward.socketStates[socket.id]!.fill).toBe(endpoint === 'target' ? selectedForward.action : selectedForward.surface);
       expect(selectedForward.socketStates[socket.id]!.stroke).toBe(selectedForward.action);
       expect(selectedForward.socketStates[socket.id]!.connectionSelected).toBe(true);
    }
    for (const key of returns) {
      expect(selectedForward.routes[key]!.color).toBe(selectedForward.action);
      expect(selectedForward.routes[key]!.arrowColor).toBe(selectedForward.action);
   }
   await screenshot('selected-forward');
   for (const key of returns) {
    const forwardBefore = returned.routes.forward!.curves;
    const route = returned.routes[key]!;
     await page.mouse.click(route.rail.midpoint.x, route.rail.midpoint.y);
    await frame();
    const selected = await inspect();
      expect(selected.routes[key]!.color).toBe(selected.action);
     for (const other of ['forward', ...returns].filter((candidate) => candidate !== key)) {
       expect(selected.routes[other]!.color, `${key} click does not select ${other}`).toBe(selected.action);
    }
    expect(selected.routes.forward!.curves, `${key} selection leaves reciprocal forward curve geometry unchanged`).toEqual(forwardBefore);
    for (const endpoint of ['source', 'target'] as const) {
      const activeSocket = selected.routes[key]![endpoint].socket;
        expect(selected.socketStates[activeSocket.id]!.stroke).toBe(selected.action);
        expect(selected.socketStates[activeSocket.id]!.fill).toBe(endpoint === 'target' ? selected.action : selected.surface);
        expect(selected.socketStates[activeSocket.id]!.connectionSelected).toBe(true);
      for (const other of ['forward', ...returns].filter((candidate) => candidate !== key)) {
        for (const otherEndpoint of ['source', 'target'] as const) {
          const otherSocket = selected.routes[other]![otherEndpoint].socket;
          if (otherSocket.id === activeSocket.id) continue;
           expect(selected.socketStates[otherSocket.id]!.stroke, `${key} click leaves ${other} ${otherEndpoint} socket alone`).toBe(selected.action);
        }
      }
    }
     await screenshot(`selected-${key}`);
   }
   // Exercise real Playwright mouse input on both vertical legs of every
   // return path. Unlike horizontal-rail clicks, these verify the close X-lanes
   // are individually hittable and that selection paints the arrow and both
   // terminal sockets without selecting a neighboring wire.
   for (const key of returns) for (const side of ['leftLeg', 'rightLeg'] as const) {
     const route = returned.routes[key]!;
     await page.mouse.click(route.rail[side].x, route.rail[side].y);
     await frame();
     const selected = await inspect();
       expect(selected.routes[key]!.color, `${key} ${side} wire core retains action color`).toBe(selected.action);
       expect(selected.routes[key]!.arrowColor, `${key} ${side} arrowhead retains action color`).toBe(selected.action);
      for (const other of ['forward', ...returns].filter((candidate) => candidate !== key)) {
        expect(selected.routes[other]!.color, `${key} ${side} click does not select ${other}`).toBe(selected.action);
        expect(selected.routes[other]!.arrowColor, `${key} ${side} click leaves ${other} arrow alone`).toBe(selected.action);
      }
      for (const endpoint of ['source', 'target'] as const) {
        const socket = selected.routes[key]![endpoint].socket;
         expect(selected.socketStates[socket.id]!.fill).toBe(endpoint === 'target' ? selected.action : selected.surface);
         expect(selected.socketStates[socket.id]!.stroke).toBe(selected.action);
         expect(selected.socketStates[socket.id]!.connectionSelected).toBe(true);
     }
     await screenshot(`selected-${key}-${side}-vertical-leg`);
   }
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Source/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/Target/REST/remote', search: '' }
  ]);
});

test('event binding keeps Example 2.LogLevel directed to Example Frontend.Preset', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example Frontend': {}, 'Example 2': {} } }));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({ events: { Preset: { node: 'Example 2', event: 'LogLevel' } } }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else {
      throw new Error(`Unexpected event-direction fixture request ${request.pathname}`);
    }
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');

  const edge = await page.evaluate(() => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; text(): string; align(): string;
      getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
      getSceneFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillStyle: string; strokeStyle: string;
      }, shape: Shape) => void;
    };
    const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const frontend = card('Example Frontend');
    const example2 = card('Example 2');
    if (!frontend || !example2) throw new Error('Event fixture cards were not rendered');
    const endpoint = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === side);
      if (!text) throw new Error(`Missing ${side} ${label}`);
      const rect = owner.find('Rect').find((item) => item.width() > 100);
      const socket = owner.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : rect?.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing ${side} ${label} socket`);
      return { point: socket.getAbsolutePosition(stage), socket: socket.name() };
    };
    const source = endpoint(example2, 'LogLevel', 'right');
    const target = endpoint(frontend, 'Preset', 'left');
    const wires = stage.find('.topology-wire');
    if (wires.length !== 1) throw new Error(`Expected one event wire, got ${wires.length}`);
    let start: Pt | undefined;
    let control1: Pt | undefined;
    let control2: Pt | undefined;
    let end: Pt | undefined;
    let arrowMove: Pt | undefined;
    let arrowLines: Pt[] = [];
    const context = {
      strokeStyle: '', fillStyle: '',
      beginPath() { arrowMove = undefined; arrowLines = []; },
      moveTo(x: number, y: number) { if (!start) start = { x, y }; arrowMove = { x, y }; },
      bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { control1 = { x: a, y: b }; control2 = { x: c, y: d }; end = { x, y }; },
      lineTo(x: number, y: number) { arrowLines.push({ x, y }); },
      closePath() {}, stroke() {}, fill() {}
    };
    const wire = wires[0]!;
    wire.getSceneFunc().call(wire, context, wire);
    if (!start || !control1 || !control2 || !end) throw new Error('Event path geometry was not painted');
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const bounds = (stage as Shape & { container(): HTMLElement }).container().getBoundingClientRect();
    const transform = stage as Shape & { x(): number; y(): number; scaleX(): number; scaleY(): number };
    const screen = (point: Pt) => ({ x: bounds.left + transform.x() + point.x * transform.scaleX(), y: bounds.top + transform.y() + point.y * transform.scaleY() });
    const layers = [...(stage as Shape & { container(): HTMLElement }).container().querySelectorAll('canvas')];
    if (layers.length !== 2 || layers.some((layer) => !(layer instanceof HTMLCanvasElement))) throw new Error('Visible wire and node/card canvases are missing');
    const firstLayer = layers[0] as HTMLCanvasElement;
    const composite = document.createElement('canvas');
    composite.width = firstLayer.width;
    composite.height = firstLayer.height;
    const pixels = composite.getContext('2d');
    if (!pixels) throw new Error('Scene canvas readback is unavailable');
    for (const layer of layers) pixels.drawImage(layer, 0, 0);
    const sample = (point: Pt, expected: string) => {
      const viewport = screen(point);
      const x = Math.round((viewport.x - bounds.left) * composite.width / bounds.width);
      const y = Math.round((viewport.y - bounds.top) * composite.height / bounds.height);
      const rgb = expected.match(/\d+/g)?.map(Number);
      if (!rgb || rgb.length < 3) throw new Error(`Unrecognized event stroke color ${expected}`);
      if (rgb.slice(0, 3).every((channel) => channel > 245)) throw new Error('Refusing white card-fill color as wire-ink evidence');
      let hits = 0;
      for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
        if (pixels.getImageData(x + dx, y + dy, 1, 1).data.slice(0, 3).every((value, channel) => Math.abs(value - rgb[channel]!) < 30)) hits += 1;
      }
      return hits;
    };
    const middle = { x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8, y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8 };
    const arrow = arrowMove && arrowLines.length === 2
      ? { x: (arrowMove.x + arrowLines[0]!.x + arrowLines[1]!.x) / 3, y: (arrowMove.y + arrowLines[0]!.y + arrowLines[1]!.y) / 3 }
      : undefined;
    return {
      id: wire.id(), source, target,
      sourceStartDistance: distance(start, source.point), targetEndDistance: distance(end, target.point),
      midpointHits: sample(middle, context.strokeStyle), arrowHits: arrow ? sample(arrow, context.strokeStyle) : 0
    };
  });
  expect(edge.id).toMatch(/^e-/);
  expect(edge.source.socket).toContain('socket-');
  expect(edge.target.socket).toContain('socket-');
  expect(edge.sourceStartDistance).toBeLessThan(0.1);
  expect(edge.targetEndDistance).toBeLessThan(0.1);
  expect(edge.midpointHits).toBeGreaterThan(0);
  expect(edge.arrowHits).toBeGreaterThan(0);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
});

test('Room Controller action and event aliases keep typed direction and paint through swaps', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Room Controller': {}, Projector: {} } }));
    } else if (request.pathname === '/nodes/RoomController/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: { 'Projector On': { node: 'Projector', action: 'Power On' } },
        events: { 'Projector Ready': { node: 'Projector', event: 'Ready' } }
      }));
    } else if (request.pathname === '/nodes/Projector/REST/remote') {
      await route.fulfill(jsonResponse({ events: { 'Room Ready': { node: 'Room Controller', event: 'Ready' } } }));
    } else {
      throw new Error(`Unexpected Room Controller fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');
  await page.getByRole('button', { name: 'Reset view' }).click();

  type Point = { x: number; y: number };
  type Endpoint = { node: string; label: string; side: 'left' | 'right'; point: Point; socket: string; localKind?: string; fill: string; stroke: string };
  type Link = { id: string; ownerId: string; kind: string; source: Endpoint; target: Endpoint; start: Point; end: Point; midpoint: Point; midpointClick: Point; arrow: Point; color: string; arrowColor: string };
  const inspect = () => page.evaluate(() => {
    type Shape = {
      id(): string; name(): string; text(): string; align(): string; x(): number; y(): number; width(): number;
      fill(): string; stroke(): string; getAttr(name: string): unknown; getAbsolutePosition(top?: Shape): Point; find(selector: string): Shape[];
       getHitFunc(): (context: { beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillShape(shape: Shape): void; strokeShape(shape: Shape): void; strokeStyle: string; fillStyle: string }, shape: Shape) => void;
    };
    type Point = { x: number; y: number };
    const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage is unavailable');
    const cards = stage.find('.topology-card');
    const cardFor = (name: string) => cards.find((card) => card.find('Text').some((text) => text.text() === name));
    const endpoint = (node: string, label: string, side: 'left' | 'right'): Endpoint => {
      const card = cardFor(node);
      if (!card) throw new Error(`Missing ${node} card`);
      const text = card.find('Text').find((item) => item.text() === label && item.align() === side);
      if (!text) throw new Error(`Missing ${node}.${label} ${side} port`);
      const body = card.find('Rect').find((rect) => rect.width() > 100);
      const socket = card.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : body?.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing socket for ${node}.${label}`);
      return { node, label, side, point: socket.getAbsolutePosition(stage), socket: socket.name(), localKind: socket.getAttr('localKind') as string | undefined, fill: socket.fill(), stroke: socket.stroke() };
    };
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const paths = stage.find('.topology-wire').map((wire) => {
      let start: Point | undefined; let end: Point | undefined; let control1: Point | undefined; let control2: Point | undefined; let arrowMove: Point | undefined; const arrowLines: Point[] = [];
      const context = {
        strokeStyle: '', fillStyle: '',
        beginPath() { arrowMove = undefined; arrowLines.length = 0; },
        moveTo(x: number, y: number) { start ??= { x, y }; arrowMove = { x, y }; },
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { control1 = { x: a, y: b }; control2 = { x: c, y: d }; end = { x, y }; },
         lineTo(x: number, y: number) { arrowLines.push({ x, y }); }, closePath() {}, stroke() {}, fill() {},
         strokeShape() {}, fillShape() { arrowColor = wire.stroke(); }
       };
       wire.getHitFunc().call(wire, context, wire);
      if (!start || !control1 || !control2 || !end || !arrowMove || arrowLines.length !== 2) throw new Error('Wire path or arrowhead missing');
      const midpoint = { x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8, y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8 };
      const route = { id: wire.id(), ownerId: wire.getAttr('ownerId') as string, kind: wire.getAttr('bindingKind') as string, start, end,
         midpoint, midpointClick: midpoint, arrow: { x: (arrowMove.x + arrowLines[0]!.x + arrowLines[1]!.x) / 3, y: (arrowMove.y + arrowLines[0]!.y + arrowLines[1]!.y) / 3 }, color: wire.stroke(), arrowColor: wire.stroke() };
      return route;
    });
    const match = (source: Endpoint, target: Endpoint, owner: string, kind: string): Link => {
      const path = paths.find((candidate) => candidate.ownerId === cardFor(owner)?.id() && candidate.kind === kind
        && distance(candidate.start, source.point) < 0.1 && distance(candidate.end, target.point) < 0.1);
      if (!path) throw new Error(`No ${kind} path for ${owner}: ${source.node}.${source.label} → ${target.node}.${target.label}`);
      return { ...path, source, target };
    };
    const links = {
      action: match(endpoint('Room Controller', 'Projector On', 'right'), endpoint('Projector', 'Power On', 'left'), 'Room Controller', 'action'),
      controllerEvent: match(endpoint('Projector', 'Ready', 'right'), endpoint('Room Controller', 'Projector Ready', 'left'), 'Room Controller', 'event'),
      projectorEvent: match(endpoint('Room Controller', 'Ready', 'right'), endpoint('Projector', 'Room Ready', 'left'), 'Projector', 'event')
    };
    const style = getComputedStyle(document.documentElement);
    const color = (name: string) => `rgb(${style.getPropertyValue(`--nodel-${name}`).trim()})`;
    const rect = stage.find('.topology-card').find((card) => card.find('Text').some((item) => item.text() === 'Room Controller'))!.getAbsolutePosition(stage);
    return { links, colors: { action: color('topology-action'), actionStrong: color('topology-action-strong'), event: color('topology-event'), eventStrong: color('topology-event-strong'), surface: color('surface') }, room: rect };
  });
  const screenshots = (name: string) => page.screenshot({ path: resolve(artifactDir, `room-controller-${name}.png`), animations: 'disabled' });
  await mkdir(artifactDir, { recursive: true });
  const initial = await inspect();
  expect(initial.links.action.source).toMatchObject({ node: 'Room Controller', side: 'right' });
  expect(initial.links.action.target).toMatchObject({ node: 'Projector', side: 'left', localKind: 'local-action' });
  expect(initial.links.controllerEvent.source).toMatchObject({ node: 'Projector', side: 'right', localKind: 'local-event' });
  expect(initial.links.controllerEvent.target).toMatchObject({ node: 'Room Controller', side: 'left' });
  expect(initial.links.projectorEvent.source).toMatchObject({ node: 'Room Controller', side: 'right', localKind: 'local-event' });
  expect(initial.links.projectorEvent.target).toMatchObject({ node: 'Projector', side: 'left' });
  expect(initial.links.action.color).toBe(initial.colors.action);
  expect(initial.links.action.arrowColor).toBe(initial.colors.action);
  for (const link of [initial.links.controllerEvent, initial.links.projectorEvent]) {
    expect(link.color).toBe(initial.colors.event);
    expect(link.arrowColor).toBe(initial.colors.event);
    expect(Math.hypot(link.arrow.x - link.end.x, link.arrow.y - link.end.y)).toBeLessThan(Math.hypot(link.arrow.x - link.start.x, link.arrow.y - link.start.y));
  }
  expect(initial.links.action.source.fill).toBe(initial.colors.surface); // remote-action alias is hollow
  expect(initial.links.action.target.fill).toBe(initial.colors.action); // provisional local action is filled
  expect(initial.links.controllerEvent.source.fill).toBe(initial.colors.event); // local event source is filled
  expect(initial.links.controllerEvent.target.fill).toBe(initial.colors.surface); // remote-event alias is hollow
  expect(initial.links.projectorEvent.source.fill).toBe(initial.colors.event);
  expect(initial.links.projectorEvent.target.fill).toBe(initial.colors.surface);
  await screenshots('light-before');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await screenshots('dark-before');
  const dark = await inspect();
  expect(dark.links.action.color).toBe(dark.colors.action);
  expect(dark.links.controllerEvent.color).toBe(dark.colors.event);
  const selectedEvent = initial.links.projectorEvent;
  const eventClick = await page.evaluate(({ point }) => {
    type Point = { x: number; y: number };
    type Stage = { getAbsoluteTransform(): { point(point: Point): Point }; container(): HTMLElement; width(): number; height(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const rect = stage.container().getBoundingClientRect();
    const transformed = stage.getAbsoluteTransform().point(point);
    return { x: rect.left + transformed.x * rect.width / stage.width(), y: rect.top + transformed.y * rect.height / stage.height() };
  }, { point: selectedEvent.arrow });
  await page.mouse.click(eventClick.x, eventClick.y);
  let selected = await inspect();
  expect(selected.links.projectorEvent.color).toBe(selected.colors.event);
  expect(selected.links.projectorEvent.arrowColor).toBe(selected.colors.event);
  expect(selected.links.projectorEvent.target.fill).toBe(selected.colors.surface);
  expect(selected.links.projectorEvent.target.stroke).toBe(selected.colors.event);
  expect(selected.links.action.color).toBe(selected.colors.action);
  expect(selected.links.controllerEvent.color).toBe(selected.colors.event);
  await screenshots('dark-selected-projector-event');
  const projector = await page.evaluate(() => {
    type Shape = { text(): string; getParent(): { x(): number; y(): number } };
    const stage = (window as Window & { Konva?: { stages?: { find(selector: string): Shape[] }[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((item) => item.text() === 'Projector');
    if (!title) throw new Error('Projector title unavailable');
    return { x: title.getParent().x(), y: title.getParent().y() };
  });
  const stageBox = await page.locator('.canvas-stage').boundingBox();
  if (!stageBox) throw new Error('Canvas stage has no bounds');
  const current = await page.evaluate(() => {
    type Shape = { x(): number; y(): number; text(): string; getParent(): { x(): number; y(): number } };
    const stage = (window as Window & { Konva?: { stages?: { find(selector: string): Shape[] }[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((item) => item.text() === 'Room Controller');
    if (!title) throw new Error('Room Controller title unavailable');
    const group = title.getParent(); return { x: group.x(), y: group.y() };
  });
  await page.mouse.move(stageBox.x + current.x + 110, stageBox.y + current.y + 24);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + projector.x + 110, stageBox.y + projector.y + 24, { steps: 8 });
  await page.mouse.up();
  selected = await inspect();
  expect(selected.links.action.id).toBe(initial.links.action.id);
  expect(selected.links.controllerEvent.id).toBe(initial.links.controllerEvent.id);
  expect(selected.links.projectorEvent.id).toBe(initial.links.projectorEvent.id);
  expect(selected.links.projectorEvent.color).toBe(selected.colors.event);
  expect(selected.links.projectorEvent.arrowColor).toBe(selected.colors.event);
  expect(selected.links.projectorEvent.target.fill).toBe(selected.colors.surface);
  expect(selected.links.projectorEvent.target.stroke).toBe(selected.colors.event);
  expect(selected.links.action.color).toBe(selected.colors.action);
  expect(selected.links.action.arrowColor).toBe(selected.colors.action);
  expect(selected.links.controllerEvent.color).toBe(selected.colors.event);
  expect(selected.links.controllerEvent.arrowColor).toBe(selected.colors.event);
  expect(Math.hypot(selected.links.projectorEvent.arrow.x - selected.links.projectorEvent.end.x, selected.links.projectorEvent.arrow.y - selected.links.projectorEvent.end.y))
    .toBeLessThan(Math.hypot(selected.links.projectorEvent.arrow.x - selected.links.projectorEvent.start.x, selected.links.projectorEvent.arrow.y - selected.links.projectorEvent.start.y));
  await screenshots('dark-selected-projector-event-swapped');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await screenshots('light-selected-projector-event-swapped');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Projector/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/RoomController/REST/remote', search: '' }
  ]);
});

test('single backward non-reciprocal edge has a visible socket stub before turning', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example Frontend': {}, 'Example 2': {} } }));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { Preset: { node: 'Example 2', action: 'power' } } }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else {
      throw new Error(`Unexpected one-way corridor fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const geometry = await page.evaluate(() => {
    type Point = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; text(): string; align(): string;
      getAbsolutePosition(top?: Shape): Point; find(selector: string): Shape[];
      getSceneFunc(): (context: { beginPath(): void; moveTo(x: number, y: number): void;
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void;
        strokeStyle: string; fillStyle: string; lineWidth: number }, shape: Shape) => void;
    };
    type Stage = Shape & { getContent(): HTMLElement; width(): number; height(): number; getAbsoluteTransform(): { point(point: Point): Point };
      getLayers(): Array<{ name(): string; getNativeCanvasElement(): HTMLCanvasElement }> };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const source = card('Example Frontend');
    const target = card('Example 2');
    if (!source || !target) throw new Error('One-way fixture cards were not rendered');
    const socket = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === (side === 'left' ? 'left' : 'right'));
      const rect = owner.find('Rect').find((item) => item.width() > 100);
      if (!text || !rect) throw new Error(`Missing ${side} ${label} endpoint`);
      const result = owner.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : rect.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!result) throw new Error(`Missing ${side} ${label} socket`);
      return result.getAbsolutePosition(stage);
    };
    const from = socket(source, 'Preset', 'right');
    const to = socket(target, 'power', 'left');
    let current: { start: Point; control1?: Point; control2?: Point; end?: Point } | undefined;
    let activePath: Array<{ start: Point; control1: Point; control2: Point; end: Point }> | undefined;
    const curves: Array<{ start: Point; control1: Point; control2: Point; end: Point }> = [];
    const context = {
      strokeStyle: '', fillStyle: '', lineWidth: 0,
      beginPath() { current = undefined; },
      moveTo(x: number, y: number) { current = { start: { x, y } }; },
      bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
        if (current) { current.control1 = { x: a, y: b }; current.control2 = { x: c, y: d }; current.end = { x, y }; }
      },
      lineTo() {}, closePath() {}, fill() {},
      stroke() {
        if (current?.control1 && current.control2 && current.end) {
          const curve = current as { start: Point; control1: Point; control2: Point; end: Point };
          curves.push(curve);
          activePath?.push(curve);
        }
      }
    };
    const matches = stage.find('.topology-wire').filter((wire) => {
      const path: typeof curves = [];
      activePath = path;
      wire.getSceneFunc().call(wire, context, wire);
      activePath = undefined;
      if (!path.length) return false;
      const first = path[0]!.start;
      const last = path.at(-1)!.end;
      return Math.hypot(first.x - from.x, first.y - from.y) < 0.1 && Math.hypot(last.x - to.x, last.y - to.y) < 0.1;
    });
    if (matches.length !== 1) throw new Error(`Expected one directed wire, found ${matches.length}`);
    const wire = matches[0]!;
    wire.getSceneFunc().call(wire, context, wire);
    const route = curves.filter((curve) => curve.end && (curve.end.x !== curve.start.x || curve.end.y !== curve.start.y));
    if (!route.length) throw new Error('The wire scene produced no cubic geometry');
    const layers = stage.getLayers();
    if (layers.length !== 2 || layers[0]!.name() !== 'wires' || layers[1]!.name() !== 'cards') throw new Error('Expected wire and card canvas layers');
    const canvas = layers[0]!.getNativeCanvasElement();
    const bounds = canvas.getBoundingClientRect();
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Point) => {
      const p = transform.point(point);
      return { x: bounds.left + p.x * bounds.width / stage.width(), y: bounds.top + p.y * bounds.height / stage.height() };
    };
    const composite = document.createElement('canvas'); composite.width = canvas.width; composite.height = canvas.height;
    const pixels = composite.getContext('2d', { willReadFrequently: true });
    const cardCanvas = layers[1]!.getNativeCanvasElement();
    if (!pixels) throw new Error('Canvas pixel readback is unavailable');
    pixels.drawImage(canvas, 0, 0); pixels.drawImage(cardCanvas, 0, 0);
    const directionX = Math.sign(route[0]!.end.x - route[0]!.start.x);
    const stubPoint = { x: from.x + directionX * 9, y: from.y };
    const viewport = screen(stubPoint);
    const px = Math.round((viewport.x - bounds.left) * composite.width / bounds.width);
    const py = Math.round((viewport.y - bounds.top) * composite.height / bounds.height);
    let ink = 0;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const pixel = pixels.getImageData(px + dx, py + dy, 1, 1).data;
      if (pixel[3]! > 0 && !(pixel[0]! > 245 && pixel[1]! > 245 && pixel[2]! > 245)) ink += 1;
    }
    return { from, to, curves: route, ink };
  });
  expect(geometry.curves[0]!.start).toEqual(geometry.from);
  expect(geometry.curves.at(-1)!.end).toEqual(geometry.to);
  expect(geometry.curves[0]!.end.x - geometry.curves[0]!.start.x).toBeGreaterThanOrEqual(12);
  expect(geometry.ink).toBeGreaterThan(0);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
});

test('cold BFCache preserves the in-flight local request and accepts its binding after back navigation', async ({ page }) => {
  const requests: RequestRecord[] = [];
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) => {
      (window as Window & { __restoredFromBfCache?: boolean }).__restoredFromBfCache = event.persisted;
    });
  });
  const started = waitGate();
  const owner = waitGate();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {}, Scheduler: {} } }));
    if (url.pathname === '/nodes/Scheduler/REST/remote') return route.fulfill(jsonResponse({}));
    expect(url.pathname).toBe('/nodes/Controller/REST/remote');
    started.release();
    await owner.promise;
    return route.fulfill(jsonResponse({ actions: { 'Run Scheduler': { node: 'Scheduler', action: 'Run' } } }));
  });
  await page.goto('/topology-canvas.html?source=local');
  await started.promise;
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  await page.goto('/topology-canvas.html?nodes=9');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => (window as Window & { __restoredFromBfCache?: boolean }).__restoredFromBfCache)).toBe(true);
  owner.release();
  await expect(page).toHaveTitle(/Local network topology/);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2, { timeout: 5_000 });
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  await expect.poll(() => page.evaluate(() => (window as Window & { Konva?: { stages?: Array<{ find(selector: string): unknown[] }> } }).Konva?.stages?.[0]?.find('.topology-wire').length)).toBe(1);
  expect(requests.map(({ method, pathname }) => `${method} ${pathname}`).sort()).toEqual([
    'GET /REST', 'GET /nodes/Controller/REST/remote', 'GET /nodes/Scheduler/REST/remote', 'POST /REST/nodeURLs'
  ]);
});

test('source selector restores a still-discovering local generation through BFCache', async ({ page }) => {
  const requests: RequestRecord[] = [];
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) => {
      (window as Window & { __sourceSelectorBfCacheRestore?: boolean }).__sourceSelectorBfCacheRestore = event.persisted;
    });
  });
  const started = waitGate();
  const owner = waitGate();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Source-selector BFCache fixture blocked unplanned origin ${url.origin}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse([]));
    if (url.pathname === '/REST' && request.method() === 'GET') return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    if (url.pathname === '/nodes/Controller/REST/remote' && request.method() === 'GET') {
      started.release();
      await owner.promise;
      return route.fulfill(jsonResponse({}));
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected source-selector BFCache API request ${request.method()} ${url.pathname}`);
  });
  await page.goto('/topology-canvas.html?source=local');
  await started.promise;
  // The real UI selector navigates while Stage A's owner fetch is outstanding.
  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => (window as Window & { __sourceSelectorBfCacheRestore?: boolean }).__sourceSelectorBfCacheRestore)).toBe(true);
  owner.release();
  await expect(page).toHaveTitle(/Local network topology/);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2, { timeout: 8_000 });
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'POST', pathname: '/REST/nodeURLs', search: '' },
    { method: 'GET', pathname: '/nodes/Controller/REST/remote', search: '' }
  ]);
});

for (const firstOwner of ['Beta', 'Alpha'] as const) {
test(`built local scene applies one frozen hop with ${firstOwner} first without replacing live Konva objects`, async ({ page }) => {
  const remote = startRemoteHost('allow', experimentOrigin);
  const remoteOrigin = await remote.listen();
  try {
    await installKonvaDrawProbe(page);
    await page.context().addCookies([{ name: 'remote-auth', value: 'must-not-cross-origin', url: remoteOrigin }]);
    const local = await installExactEnrichmentFixture(page, remoteOrigin, [remoteOrigin], 1_200);
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await expect(page.locator('[data-fixture-summary]')).toContainText('3 nodes');
    await Promise.all([remote.started.Alpha.promise, remote.started.Beta.promise]);

    const beforeScene = await inspectKonvaScene(page, true);
    expect(beforeScene.cardNames).toEqual(['Alpha', 'Beta', 'Owner']);
    expect(beforeScene.wireCount).toBe(2);
    const initialMountFirstDrawAtMs = await page.evaluate(() => {
      const probe = (window as Window & { __konvaDrawProbe?: { firstDrawAt?: number } }).__konvaDrawProbe;
      if (!probe?.firstDrawAt) throw new Error('No actual Konva canvas draw was observed during initial mount');
      return probe.firstDrawAt;
    });

    const dragStart = await page.evaluate(() => {
      type Point = { x: number; y: number };
      type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top: Shape): Point };
      type Stage = Shape & { getContent(): HTMLElement; find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Konva stage unavailable before drag');
      const card = stage.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === 'Alpha'));
      if (!card) throw new Error('Alpha card unavailable before drag');
      const position = card.getAbsolutePosition(stage);
      const bounds = stage.getContent().getBoundingClientRect();
      return { x: bounds.left + stage.x() + (position.x + 55) * stage.scaleX(), y: bounds.top + stage.y() + (position.y + 48) * stage.scaleY() };
    });
    await page.mouse.click(dragStart.x, dragStart.y);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 34, dragStart.y + 26, { steps: 5 });
    const activeDrag = await page.evaluate(() => {
      type Shape = { text(): string; find(selector: string): Shape[]; isDragging(): boolean };
      type Stage = Shape & { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const card = stage?.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === 'Alpha'));
      return card?.isDragging() ?? false;
    });
    expect(activeDrag).toBe(true);
    const firstOwnerVisible = page.evaluate((owner) => {
      const probe = (window as Window & { __konvaDrawProbe?: { waitForPatch(ownerName: 'Alpha' | 'Beta'): Promise<{ responseEndAt: number; visibleAt: number; method: string }> } }).__konvaDrawProbe;
      if (!probe) throw new Error('Konva draw probe is unavailable');
      return probe.waitForPatch(owner);
    }, firstOwner);
    const secondOwner = firstOwner === 'Alpha' ? 'Beta' : 'Alpha';
    const secondOwnerVisible = page.evaluate((owner) => {
      const probe = (window as Window & { __konvaDrawProbe?: { waitForPatch(ownerName: 'Alpha' | 'Beta'): Promise<{ responseEndAt: number; visibleAt: number; method: string }> } }).__konvaDrawProbe;
      if (!probe) throw new Error('Konva draw probe is unavailable');
      return probe.waitForPatch(owner);
    }, secondOwner);
    // Keep the card in a native drag while the first response patches the live scene.
    remote.arrivals[firstOwner].release();
    const firstPaint = await firstOwnerVisible;
    const secondOwnerName = firstOwner === 'Alpha' ? 'Beta' : 'Alpha';
    expect(await readCardDescription(page, firstOwner)).toContain(`Advertised host: ${new URL(remoteOrigin).host}.`);
    expect(await readCardDescription(page, secondOwnerName)).toContain('Not inspected.');
    expect((await inspectKonvaScene(page)).dragging.Alpha).toBe(true);
    const gammaPositionAfterFirst = await readCardPosition(page, 'Gamma');
    remote.arrivals[secondOwner].release();
    const secondPaint = await secondOwnerVisible;
    await expect.poll(() => readCardDescription(page, firstOwner)).toContain('Inspection succeeded;');
    await expect.poll(() => readCardDescription(page, secondOwner)).toContain('Inspection succeeded;');
    const afterScene = await inspectKonvaScene(page);
    expect(afterScene.cardNames).toEqual(['Alpha', 'Beta', 'Gamma', 'Owner']);
    expect(afterScene.wireCount).toBe(4);
    expect(afterScene.camera).toEqual({ ...beforeScene.camera, ...centeredTranslation(beforeScene.viewport, afterScene.viewport, beforeScene.camera.x, beforeScene.camera.y) });
    expect(afterScene.dragging.Alpha).toBe(true);
    expect(afterScene.selected).toEqual(['Alpha']);
    expect(afterScene.retainedShapes).toBeGreaterThan(0);
    expect(afterScene.touchedShapes + afterScene.addedShapes).toBeLessThan(beforeScene.shapeCount);
    expect(await readCardPosition(page, 'Gamma')).toEqual(gammaPositionAfterFirst);

    const identity = await page.evaluate(() => {
      type Shape = { id(): string; name(): string; find(selector: string): Shape[]; text(): string };
      type Stage = Shape & { find(selector: string): Shape[] };
      const state = window as Window & {
        Konva?: { stages?: Stage[] };
        __enrichmentRefs?: { stage: Stage; cards: Map<string, Shape>; sockets: Map<string, Shape>; wires: Map<string, Shape> };
      };
      const stage = state.Konva?.stages?.[0];
      const before = state.__enrichmentRefs;
      if (!stage || !before) throw new Error('Konva identity baseline was not saved');
      const currentCards = new Map(stage.find('.topology-card').map((card): [string, Shape] => {
        const name = card.find('Text').map((text) => text.text()).find((value) => ['Owner', 'Alpha', 'Beta', 'Gamma'].includes(value));
        return [name ?? '', card];
      }));
      const currentSockets = new Map<string, Shape>();
      for (const [owner, card] of currentCards) {
        for (const socket of card.find('Circle').filter((shape) => shape.name().startsWith('socket-'))) currentSockets.set(`${owner}:${socket.name()}`, socket);
      }
      const currentWires = new Map(stage.find('.topology-wire').map((wire): [string, Shape] => [wire.id(), wire]));
      const preserved = (old: Map<string, Shape>, current: Map<string, Shape>) => [...old].every(([key, shape]) => current.get(key) === shape);
      return {
        stage: stage === before.stage,
        cards: preserved(before.cards, currentCards),
        sockets: preserved(before.sockets, currentSockets),
        wires: preserved(before.wires, currentWires)
      };
    });
    expect(identity).toEqual({ stage: true, cards: true, sockets: true, wires: true });

    await page.mouse.up();
    expect((await inspectKonvaScene(page)).dragging.Alpha).toBe(false);
    const afterScreenshotName = `enrichment-${firstOwner.toLowerCase()}-first-after.png`;
    const afterScreenshot = await page.screenshot({ path: resolve(artifactDir, afterScreenshotName), animations: 'disabled' });
    await test.info().attach(afterScreenshotName, { body: afterScreenshot, contentType: 'image/png' });

    const metrics = {
      initialMountFirstActualKonvaDrawAtMs: Number(initialMountFirstDrawAtMs.toFixed(2)),
      firstOwner: { name: firstOwner, completionToVisibleKonvaDrawMs: Number((firstPaint.visibleAt - firstPaint.responseEndAt).toFixed(2)), drawMethod: firstPaint.method },
      secondOwner: { name: secondOwner, completionToVisibleKonvaDrawMs: Number((secondPaint.visibleAt - secondPaint.responseEndAt).toFixed(2)), drawMethod: secondPaint.method },
      responseOrder: [firstOwner, secondOwner],
      initialMountedShapes: beforeScene.shapeCount,
      retainedExistingShapes: afterScene.retainedShapes,
      touchedExistingShapes: afterScene.touchedShapes,
      insertedShapes: afterScene.addedShapes
    };
    await test.info().attach(`enrichment-render-metrics-${firstOwner.toLowerCase()}-first.json`, { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    await writeFile(resolve(artifactDir, `enrichment-render-metrics-${firstOwner.toLowerCase()}-first.json`), `${JSON.stringify(metrics, null, 2)}\n`);

    await page.getByRole('button', { name: 'Reset view' }).click();
    const reset = await inspectKonvaScene(page);
    expect(reset.camera).not.toEqual(afterScene.camera);
    const visibility = await page.evaluate(() => {
      type Point = { x: number; y: number };
      type Shape = { text(): string; x(): number; y(): number; width(): number; height(): number; find(selector: string): Shape[]; getAbsolutePosition(top: Shape): Point };
      type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; width(): number; height(): number };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Konva stage unavailable after Reset');
      const visible = stage.find('.topology-card').map((card) => {
        const title = card.find('Text').find((text) => ['Owner', 'Alpha', 'Beta', 'Gamma'].includes(text.text()));
        const body = card.find('Rect').find((rect) => rect.width() > 100);
        if (!title || !body) throw new Error('A live card lacks its title or body rectangle');
        const point = card.getAbsolutePosition(stage);
        return {
          name: title.text(),
          left: stage.x() + point.x * stage.scaleX(),
          top: stage.y() + point.y * stage.scaleX(),
          right: stage.x() + (point.x + body.width()) * stage.scaleX(),
          bottom: stage.y() + (point.y + body.height()) * stage.scaleX()
        };
      });
      return { viewport: { width: stage.width(), height: stage.height() }, cards: visible };
    });
    expect(visibility.cards.map(({ name }) => name).sort()).toEqual(['Alpha', 'Beta', 'Gamma', 'Owner']);
    for (const card of visibility.cards) {
      expect(card.left, `${card.name} left of Reset viewport`).toBeGreaterThanOrEqual(-1);
      expect(card.top, `${card.name} above Reset viewport`).toBeGreaterThanOrEqual(-1);
      expect(card.right, `${card.name} right of Reset viewport`).toBeLessThanOrEqual(visibility.viewport.width + 1);
      expect(card.bottom, `${card.name} below Reset viewport`).toBeLessThanOrEqual(visibility.viewport.height + 1);
    }
    expect(local.lookupNames.sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(remote.requests.map(({ pathname }) => pathname).sort()).toEqual([
      '/nodes/Alpha/REST/remote', '/nodes/Beta/REST/remote'
    ]);
    expect(remote.requests.every(({ origin }) => origin === experimentOrigin)).toBe(true);
    expect(remote.requests.every(({ cookie }) => cookie === undefined)).toBe(true);
    expect(local.requests.map(({ method, pathname }) => `${method} ${pathname}`).sort()).toEqual([
      'GET /REST', 'GET /nodes/Owner/REST/remote', 'POST /REST/nodeURLsForNode', 'POST /REST/nodeURLsForNode', 'POST /REST/nodeURLsForNode'
    ]);
  } finally {
    await remote.close();
  }
});
}

test('host header indicators expose vetted remote and complete-empty evidence without layout or request churn', async ({ page }) => {
  const remote = startRemoteHost('allow', experimentOrigin, { Alpha: {}, Beta: {} }, false);
  const remoteOrigin = await remote.listen();
  try {
    const local = await installExactEnrichmentFixture(page, remoteOrigin);
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await Promise.all([remote.started.Alpha.promise, remote.started.Beta.promise]);
    await expect.poll(() => local.lookupNames.length).toBe(2);
    await expect(page.locator('[data-fixture-summary]')).toContainText('3 complete');
    const initial = await page.evaluate(() => {
      type Shape = { id(): string; name(): string; text(): string; x(): number; y(): number; width(): number; height(): number; find(selector: string): Shape[]; getAttr(name: string): unknown };
      type Stage = Shape & { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Konva stage is unavailable before empty remote reads');
      return stage.find('.topology-card').map((card) => {
        const title = card.find('Text').map((text) => text.text()).find((text) => ['Owner', 'Alpha', 'Beta'].includes(text));
        const rect = card.find('Rect').find((shape) => shape.width() > 100);
        if (!title || !rect) throw new Error('A local or referenced card is missing its header');
        return { title, position: { x: card.x(), y: card.y() }, size: { width: rect.width(), height: rect.height() }, description: card.getAttr('accessibleDescription') };
      });
    });
    expect(initial.find(({ title }) => title === 'Owner')?.description).toContain('Hosted on this page’s Nodel server.');
    expect(initial.filter(({ title }) => title === 'Alpha' || title === 'Beta').every(({ description }) =>
      typeof description === 'string' && description.includes('Advertised host:')
    )).toBe(true);
    const stageHost = page.locator('.canvas-stage');
    const compactSummaryBeforeRead = await page.locator('[data-fixture-summary]').textContent();
    await page.evaluate(() => {
      type Shape = { id(): string; text(): string; find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
      const alpha = stage?.find('.topology-card').find((card) => card.find('Text').some((text) => text.text() === 'Alpha'));
      if (!alpha) throw new Error('Alpha card unavailable for stable identity check');
      (window as Window & { __activeHeaderAlpha?: Shape }).__activeHeaderAlpha = alpha;
      return alpha.id();
    });
    await stageHost.focus();
    const alphaIndex = initial.findIndex(({ title }) => title === 'Alpha');
    for (let index = 0; index < alphaIndex; index += 1) await page.keyboard.press('ArrowRight');
    await expect(stageHost).toHaveAttribute('aria-label', new RegExp('^Alpha\\.'));
    const betaPoint = await page.evaluate(() => {
      type Shape = { text(): string; find(selector: string): Shape[]; width(): number; getAbsolutePosition(top: Shape): { x: number; y: number } };
      type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; scaleY(): number; container(): HTMLElement };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const beta = stage?.find('.topology-card').find((card) => card.find('Text').some((text) => text.text() === 'Beta'));
      if (!stage || !beta) throw new Error('Beta card unavailable for pointer-priority check');
      const position = beta.getAbsolutePosition(stage);
      const bounds = stage.container().getBoundingClientRect();
      return { x: bounds.left + stage.x() + (position.x + beta.width() / 2) * stage.scaleX(), y: bounds.top + stage.y() + (position.y + 22) * stage.scaleY() };
    });
    await page.mouse.move(betaPoint.x, betaPoint.y);
    await expect(stageHost).toHaveAttribute('aria-label', new RegExp('^Alpha\\.'));
    expect(await page.locator('[data-fixture-summary]').textContent()).toBe(compactSummaryBeforeRead);
    await expect(page.locator('.canvas-failure')).toHaveClass(/is-visually-hidden/);
    await expect(page.locator('.canvas-failure')).toContainText('Alpha.');
    await expect.poll(() => stageHost.getAttribute('title')).toContain(`Advertised host: ${new URL(remoteOrigin).host}. Inspection succeeded; 0 configured bindings, none unassigned.`);
    expect((await stageHost.getAttribute('title'))?.length ?? 321).toBeLessThanOrEqual(320);
    await expect(stageHost).toHaveAttribute('aria-label', new RegExp(`^Alpha\\. Advertised host: ${new URL(remoteOrigin).host.replaceAll('.', '\\.')}\\.`));
    const identityAfterPatch = await page.evaluate(() => {
      type Shape = { text(): string; find(selector: string): Shape[] };
      const state = window as Window & { __activeHeaderAlpha?: Shape; Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } };
      const alpha = state.Konva?.stages?.[0]?.find('.topology-card').find((card) => card.find('Text').some((text) => text.text() === 'Alpha'));
      return Boolean(alpha && alpha === state.__activeHeaderAlpha);
    });
    expect(identityAfterPatch).toBe(true);
    await expect(page.locator('[data-fixture-summary]')).toContainText('3 complete');
    const compactSummary = await page.locator('[data-fixture-summary]').textContent();

    const completed = await page.evaluate(() => {
      type Shape = { id(): string; name(): string; text(): string; x(): number; y(): number; width(): number; height(): number; find(selector: string): Shape[]; getAttr(name: string): unknown };
      type Stage = Shape & { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Konva stage is unavailable after empty remote reads');
      const cards = stage.find('.topology-card').map((card) => {
        const texts = card.find('Text').map((text) => text.text());
        const title = texts.find((text) => ['Owner', 'Alpha', 'Beta'].includes(text));
        const rect = card.find('Rect').find((shape) => shape.width() > 100);
        if (!title || !rect) throw new Error('A local or referenced card is missing its header');
        const hostGlyph = card.find('Group').find((group) => group.name().startsWith('host-location-'));
        return { title, position: { x: card.x(), y: card.y() }, size: { width: rect.width(), height: rect.height() }, description: card.getAttr('accessibleDescription'), hostGlyph: hostGlyph?.name(), texts };
      });
      return cards;
    });
    const alpha = completed.find(({ title }) => title === 'Alpha');
    const beta = completed.find(({ title }) => title === 'Beta');
    expect(alpha?.hostGlyph).toBe('host-location-remote');
    expect(beta?.hostGlyph).toBe('host-location-remote');
    for (const card of [alpha, beta]) {
      expect(card?.description).toContain(`Advertised host: ${new URL(remoteOrigin).host}.`);
      expect(card?.description).not.toContain('http');
      expect(card?.description).not.toContain('/nodes/');
      expect(card?.description).toContain('Inspection succeeded; 0 configured bindings, none unassigned.');
    }
    expect(completed.map(({ title, position, size }) => ({ title, position, size }))).toEqual(
      initial.map(({ title, position, size }) => ({ title, position, size }))
    );

    await expect(stageHost).toHaveAttribute('aria-label', new RegExp(`^Alpha\\. Advertised host: ${new URL(remoteOrigin).host.replaceAll('.', '\\.')}\\.`));
    await expect(page.locator('[data-fixture-summary]')).toHaveText(compactSummary ?? '');
    await page.getByRole('button', { name: 'Reset view' }).focus();
    await expect(stageHost).toHaveAttribute('aria-label', new RegExp(`^Beta\\. Advertised host: ${new URL(remoteOrigin).host.replaceAll('.', '\\.')}\\.`));
    const requestsBeforeControls = [...local.requests];
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    expect(local.requests).toEqual(requestsBeforeControls);
    expect(remote.requests.map(({ pathname }) => pathname).sort()).toEqual(['/nodes/Alpha/REST/remote', '/nodes/Beta/REST/remote']);
    expect(local.lookupNames.sort()).toEqual(['Alpha', 'Beta']);
  } finally {
    await remote.close();
  }
});

test('advertised binding discovery crosses shared cycles once without a depth cutoff', async ({ page }) => {
  const remoteRequests: string[] = [];
  const arrivals = { Alpha: waitGate(), Beta: waitGate(), Gamma: waitGate() };
  const started = { Alpha: waitGate(), Beta: waitGate(), Gamma: waitGate() };
  const bindings: Record<string, unknown> = {
    Alpha: { actions: {
      'Call Gamma': { node: 'Gamma', action: 'Activate' },
      'Cycle to Beta': { node: 'Beta', action: 'Back' }
    } },
    Beta: { actions: {
      'Share Gamma': { node: 'Gamma', action: 'Start' },
      'Cycle to Alpha': { node: 'Alpha', action: 'Back' }
    } },
    Gamma: {}
  };
  const remoteServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    remoteRequests.push(`${request.method ?? ''} ${path}`);
    const owner = /^\/nodes\/(Alpha|Beta|Gamma)\/REST\/remote$/.exec(path)?.[1];
    if (request.method !== 'GET' || !owner) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', experimentOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Content-Type', 'application/json');
    const send = () => {
      response.writeHead(200, { 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(bindings[owner]));
    };
    if (owner === 'Alpha' || owner === 'Beta') {
      started[owner].release();
      void arrivals[owner].promise.then(send);
    } else {
      started.Gamma.release();
      send();
    }
  });
  const remoteOrigin = await listenLoopback(remoteServer);
  const localRequests: RequestRecord[] = [];
  const lookups: string[] = [];
  try {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === remoteOrigin) return route.continue();
      if (url.origin !== experimentOrigin) {
        await route.abort('blockedbyclient');
        throw new Error(`Discovery loopback fixture blocked unplanned origin ${url.origin}`);
      }
      if (!apiPath(url.pathname)) return route.continue();
      localRequests.push({ method: request.method(), pathname: url.pathname, search: url.search });
      if (url.pathname === '/REST' && request.method() === 'GET') {
        await route.fulfill(jsonResponse({ nodes: { Owner: {} } }));
      } else if (url.pathname === '/REST/nodeURLs' && request.method() === 'POST') {
        await route.fulfill(jsonResponse([{ node: 'Gamma', address: `${remoteOrigin}/nodes/Gamma` }]));
      } else if (url.pathname === '/nodes/Owner/REST/remote' && request.method() === 'GET') {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200));
        await route.fulfill(jsonResponse({ actions: {
          'Call Alpha': { node: 'Alpha', action: 'Prepare' },
          'Call Beta': { node: 'Beta', action: 'Prepare' }
        } }));
      } else if (url.pathname === '/REST/nodeURLsForNode' && request.method() === 'POST') {
        const name = (request.postDataJSON() as { name?: unknown }).name;
        if (typeof name !== 'string' || !['Alpha', 'Beta'].includes(name)) {
          throw new Error(`Discovery fixture attempted unexpected exact lookup: ${String(name)}`);
        }
        lookups.push(name);
        await route.fulfill(jsonResponse([{ node: name, address: `${remoteOrigin}/nodes/${name}` }]));
      } else {
        await route.abort('blockedbyclient');
        throw new Error(`Unexpected discovery local API request ${request.method()} ${url.pathname}`);
      }
    });
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await Promise.all([started.Alpha.promise, started.Beta.promise, started.Gamma.promise]);

    await mkdir(artifactDir, { recursive: true });
    const summary = async () => (await page.locator('[data-fixture-summary]').textContent()) ?? '';
    const screenshots = {
      initial: 'discovery-initial.png',
      mid: 'discovery-mid.png',
      settled: 'discovery-settled.png'
    };
    const initialSummary = await summary();
    await page.screenshot({ path: resolve(artifactDir, screenshots.initial), animations: 'disabled' });

    const mounted = await inspectKonvaScene(page, true);
    expect(mounted.cardNames).toEqual(['Alpha', 'Beta', 'Gamma', 'Owner']);
    expect(mounted.wireCount).toBe(2);
    await page.evaluate(() => {
      const stage = (window as Window & { Konva?: { stages?: unknown[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Discovery stage unavailable before enrichment');
      (window as Window & { __depthTwoStage?: unknown }).__depthTwoStage = stage;
    });
    arrivals.Alpha.release();
    arrivals.Beta.release();
    await expect.poll(async () => (await inspectKonvaScene(page)).wireCount).toBe(6);
    const midSummary = await summary();
    await page.screenshot({ path: resolve(artifactDir, screenshots.mid), animations: 'disabled' });
    arrivals.Gamma.release();
    await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');

    const result = await inspectKonvaScene(page);
    expect(result.camera).toEqual({ ...mounted.camera, ...centeredTranslation(mounted.viewport, result.viewport, mounted.camera.x, mounted.camera.y) });
    expect(result.wireCount).toBe(6);
    const scene = await page.evaluate(() => {
      type Shape = { id(): string; text(): string; find(selector: string): Shape[] };
      type Stage = Shape & { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Discovery Konva stage disappeared');
      const cards = stage.find('.topology-card').map((card) => card.find('Text').map((text) => text.text()).find(Boolean)).filter((name): name is string => Boolean(name)).sort();
      const wireIds = stage.find('.topology-wire').map((wire) => wire.id()).sort();
      const original = (window as Window & { __depthTwoStage?: unknown }).__depthTwoStage;
      return { sameStage: stage === original, cards, wireIds };
    });
    expect(scene.sameStage).toBe(true);
    expect(scene.cards).toEqual(['Alpha', 'Beta', 'Gamma', 'Owner']);
    // Binding IDs prove the two shared Gamma references and reciprocal cycle edges.
    const expectedWireIds = [
      ['binding', 'simple:owner', 'action', 'simple:callalpha'],
      ['binding', 'simple:owner', 'action', 'simple:callbeta'],
      ['binding', 'simple:alpha', 'action', 'simple:callgamma'],
      ['binding', 'simple:alpha', 'action', 'simple:cycletobeta'],
      ['binding', 'simple:beta', 'action', 'simple:sharegamma'],
      ['binding', 'simple:beta', 'action', 'simple:cycletoalpha'],
    ].map((parts) => `e-${Array.from(JSON.stringify(parts), (character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`).sort();
    expect(scene.wireIds).toEqual(expectedWireIds);
    expect(lookups.sort()).toEqual(['Alpha', 'Beta']);
    expect(remoteRequests.sort()).toEqual([
      'GET /nodes/Alpha/REST/remote', 'GET /nodes/Beta/REST/remote', 'GET /nodes/Gamma/REST/remote'
    ]);
    expect(localRequests.filter(({ pathname }) => pathname === '/REST/nodeURLsForNode').length).toBe(2);
    expect(localRequests.filter(({ pathname }) => pathname === '/REST/nodeURLs').length).toBe(1);
    await page.screenshot({ path: resolve(artifactDir, screenshots.settled), animations: 'disabled' });
    const evidence = {
      fixture: 'advertised binding discovery: shared target and reciprocal cycles across discovery depth',
      screenshots,
      actualSummary: { initial: initialSummary, mid: midSummary, settled: await summary() },
      lookups: [...lookups].sort(),
      uniqueRemoteGets: [...remoteRequests].sort(),
      localRequestCounts: {
        inventory: localRequests.filter(({ pathname }) => pathname === '/REST/nodeURLs').length,
        exactLookup: localRequests.filter(({ pathname }) => pathname === '/REST/nodeURLsForNode').length
      }
    };
    const evidencePath = resolve(artifactDir, 'discovery-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await test.info().attach('discovery-evidence.json', { path: evidencePath, contentType: 'application/json' });
  } finally {
    arrivals.Alpha.release();
    arrivals.Beta.release();
    arrivals.Gamma.release();
    await closeServer(remoteServer);
  }
});

test('advertisements, exact-name provisional targets, empty reads, unreachable routes, and no-route nodes stay distinct', async ({ page }) => {
  const gets: string[] = [];
  const lookups: string[] = [];
  const inventory = [
    { node: 'Alpha', address: `${experimentOrigin}/nodes/Alpha` },
    { node: 'Beta', address: `${experimentOrigin}/nodes/Beta` },
    { node: 'Shared', address: `${experimentOrigin}/nodes/Shared` },
    { node: 'EmptyAdvertised', address: `${experimentOrigin}/nodes/EmptyAdvertised` },
    { node: 'Unreachable', address: `${experimentOrigin}/nodes/Unreachable` },
    { node: 'No Route' }
  ];
  const remoteBindings: Record<string, unknown> = {
    Owner: { actions: { 'Use provisional target': { node: 'ProvisionalNode', action: 'Wake' } } },
    Alpha: { actions: { 'Share cross depth': { node: 'Shared', action: 'Start' } } },
    Beta: { actions: { 'Also share cross depth': { node: 'Shared', action: 'Stop' } } },
    Shared: { actions: { 'Return to Alpha': { node: 'Alpha', action: 'Back' } } },
    EmptyAdvertised: {},
    ProvisionalNode: {}
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Topology fixture blocked unexpected origin ${url.origin}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Owner: {} } }));
    if (request.method() === 'GET' && url.pathname.endsWith('/REST/remote')) {
      const owner = decodeURIComponent(url.pathname.split('/')[2] ?? '');
      gets.push(owner);
      if (owner === 'Unreachable') return route.fulfill(jsonResponse({ unavailable: true }, 503));
      const payload = remoteBindings[owner];
      if (payload === undefined) return route.fulfill(jsonResponse({}));
      return route.fulfill(jsonResponse(payload));
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') return route.fulfill(jsonResponse(inventory));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') {
      const name = (request.postDataJSON() as { name?: unknown }).name;
      if (name !== 'ProvisionalNode') throw new Error(`Unexpected exact lookup name: ${String(name)}`);
      lookups.push(name);
      return route.fulfill(jsonResponse([{ node: 'ProvisionalNode', address: `${experimentOrigin}/nodes/ProvisionalNode` }]));
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected topology request ${request.method()} ${url.pathname}`);
  });

  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect.poll(() => gets.length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-fixture-summary]')).toContainText('discovered');
  await expect.poll(() => gets.length).toBeGreaterThanOrEqual(6, { timeout: 25_000 });
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 no-route');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 unreachable');
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');

  const cardTitles = await page.evaluate(() => {
    type Shape = { find(selector: string): Shape[]; text(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<{ find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Topology stage unavailable after settlement');
    return stage.find('.topology-card').map((card) => card.find('Text').map((text) => text.text()).find(Boolean)).filter((name): name is string => Boolean(name)).sort();
  });
  expect(cardTitles).toHaveLength(8);
  expect(cardTitles).toEqual(expect.arrayContaining([
    'Owner', 'Alpha', 'Beta', 'Shared', 'EmptyAdvertised', 'Unreachable', 'No Route', 'ProvisionalNode'
  ]));
  expect(lookups).toEqual(['ProvisionalNode']);
  expect(gets.filter((name) => name === 'Shared')).toHaveLength(1);
  expect(gets.filter((name) => name === 'EmptyAdvertised')).toHaveLength(1);
  expect(gets.filter((name) => name === 'Unreachable')).toHaveLength(1);
  expect(gets.filter((name) => name === 'No Route')).toHaveLength(0);
  expect(gets.filter((name) => name === 'ProvisionalNode')).toHaveLength(1);
  expect(gets).toHaveLength(new Set(gets).size);
});

test('representative built discovery preserves local identity and renders disconnected, isolated, unreadable, and exact-lookup cases', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  const advertised = ['PairA', 'PairB', 'IsolatedEmpty', 'Unreadable'];
  const remoteGets: string[] = [];
  const exactLookups: string[] = [];
  const inventoryStarted = waitGate();
  const inventoryRelease = waitGate();
  const exactLookupRelease = waitGate();
  const inventory = advertised.map((node) => ({ node, address: `${experimentOrigin}/nodes/${node}` }));
  const bindings: Record<string, unknown> = {
    Anchor: { actions: {
      'Find binding peer': { node: 'BindingPeer', action: 'Wake' },
      'Try no route': { node: 'NoRoute', action: 'Wake' }
    } },
    PairA: { actions: { 'Connect pair': { node: 'PairB', action: 'Receive' } } },
    PairB: { actions: { 'Retain unreadable wire': { node: 'Unreadable', action: 'Unavailable' } } },
    IsolatedEmpty: {},
    BindingPeer: {}
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Representative fixture blocked unexpected origin ${url.origin}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    if (request.method() === 'GET' && url.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Anchor: {} } }));
      return;
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/REST/remote')) {
      const owner = decodeURIComponent(url.pathname.split('/')[2] ?? '');
      remoteGets.push(owner);
      if (owner === 'Unreadable') {
        await route.fulfill(jsonResponse({ error: 'fixture unreadable' }, 403));
        return;
      }
      await route.fulfill(jsonResponse(bindings[owner] ?? {}));
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      inventoryStarted.release();
      await inventoryRelease.promise;
      await route.fulfill(jsonResponse(inventory));
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') {
      const name = (request.postDataJSON() as { name?: unknown }).name;
      if (name !== 'BindingPeer' && name !== 'NoRoute') throw new Error(`Unexpected exact lookup ${String(name)}`);
      exactLookups.push(name);
      await exactLookupRelease.promise;
      await route.fulfill(jsonResponse(name === 'BindingPeer'
        ? [{ node: 'BindingPeer', address: `${experimentOrigin}/nodes/BindingPeer` }]
        : []));
      return;
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected representative fixture request ${request.method()} ${url.pathname}`);
  });

  const inspectScene = () => page.evaluate(() => {
    type Shape = {
      find(selector: string): Shape[];
      text(): string;
      id(): string;
      x(): number;
      y(): number;
      position(): { x: number; y: number };
      scaleX(): number;
      scaleY(): number;
      visible(): boolean;
      width(): number;
      height(): number;
      getClientRect(config?: { relativeTo?: Shape }): { x: number; y: number; width: number; height: number };
      scale(value?: { x: number; y: number }): { x: number; y: number } | void;
      batchDraw(): void;
    };
    const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Representative topology stage is unavailable');
    const cards = stage.find('.topology-card');
    const names = cards.map((card) => card.find('Text').map((text) => text.text()).find(Boolean)).filter((name): name is string => Boolean(name)).sort();
    const anchor = cards.find((card) => card.find('Text').some((text) => text.text() === 'Anchor'));
    if (!anchor) throw new Error('Local Anchor is missing from the topology stage');
    const position = anchor.position();
    const camera = { position: stage.position(), scale: { x: stage.scaleX(), y: stage.scaleY() } };
    const wireIds = stage.find('.topology-wire').filter((wire) => wire.visible()).map((wire) => wire.id()).sort();
    return { names, wireIds, camera, anchor: { x: position.x, y: position.y }, dimensions: { width: stage.width(), height: stage.height() } };
  });

  try {
    await page.goto('/topology-canvas.html?source=local');
    const summary = page.locator('[data-fixture-summary]');
    await inventoryStarted.promise;
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await expect.poll(async () => (await inspectScene()).names).toEqual(expect.arrayContaining(['Anchor', 'BindingPeer', 'NoRoute']));
    const initialScene = await inspectScene();
    expect(initialScene.names).toContain('Anchor');
    expect(initialScene.names).not.toContain('PairA');
    expect(initialScene.names).not.toContain('IsolatedEmpty');
    const initialSummary = (await summary.textContent()) ?? '';
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: resolve(artifactDir, 'representative-discovery-initial.png'), animations: 'disabled' });

    inventoryRelease.release();
    exactLookupRelease.release();
    await expect(summary).toContainText('scheduler settled', { timeout: 20_000 });
    await expect(summary).toContainText('1 no-route');
    await expect(summary).toContainText('1 unreachable');
    const settledSummary = (await summary.textContent()) ?? '';
    const parseCounts = (text: string) => {
      const match = /(\d+) nodes · (\d+) complete · (\d+) partial · (\d+) queued · (\d+) terminal not inspected/.exec(text);
      if (!match) throw new Error(`Unrecognized representative progress summary: ${text}`);
      return { nodes: Number(match[1]), complete: Number(match[2]), partial: Number(match[3]), queued: Number(match[4]), terminalNotInspected: Number(match[5]) };
    };
    const initialCounts = parseCounts(initialSummary);
    const settledCounts = parseCounts(settledSummary);
    const settledScene = await inspectScene();
    expect(settledScene.names).toEqual(['Anchor', 'BindingPeer', 'IsolatedEmpty', 'NoRoute', 'PairA', 'PairB', 'Unreadable']);
    expect(settledScene.wireIds).toHaveLength(4);
    const edgeId = (parts: string[]) => `e-${Array.from(JSON.stringify(parts), (character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
    const expectedWireIds = [
      ['binding', 'simple:anchor', 'action', 'simple:findbindingpeer'],
      ['binding', 'simple:anchor', 'action', 'simple:trynoroute'],
      ['binding', 'simple:paira', 'action', 'simple:connectpair'],
      ['binding', 'simple:pairb', 'action', 'simple:retainunreadablewire']
    ].map(edgeId).sort();
    expect(settledScene.wireIds).toEqual(expectedWireIds);
    expect(remoteGets.sort()).toEqual(['Anchor', 'BindingPeer', 'IsolatedEmpty', 'PairA', 'PairB', 'Unreadable'].sort());
    expect(remoteGets).toHaveLength(new Set(remoteGets).size);
    expect(exactLookups.sort()).toEqual(['BindingPeer', 'NoRoute']);
    expect(settledScene.camera).toEqual(initialScene.camera);
    expect(settledScene.anchor).toEqual(initialScene.anchor);

    const screenshotFrame = await page.evaluate(() => {
      type Shape = {
        find(selector: string): Shape[];
        text(): string;
        getClientRect(config?: { relativeTo?: Shape }): { x: number; y: number; width: number; height: number };
        position(value?: { x: number; y: number }): { x: number; y: number } | void;
        scaleX(): number;
        scaleY(): number;
        scale(value?: { x: number; y: number }): { x: number; y: number } | void;
        width(): number;
        height(): number;
        batchDraw(): void;
      };
      const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Representative topology stage is unavailable for screenshot framing');
      const cards = stage.find('.topology-card');
      const bounds = cards.map((card) => card.getClientRect({ relativeTo: stage }));
      const minX = Math.min(...bounds.map((rect) => rect.x));
      const minY = Math.min(...bounds.map((rect) => rect.y));
      const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
      const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));
      const padding = 52;
      const fitScale = Math.min((stage.width() - padding * 2) / (maxX - minX), (stage.height() - padding * 2) / (maxY - minY), 1.25);
      stage.scale({ x: fitScale, y: fitScale });
      stage.position({
        x: (stage.width() - (maxX - minX) * fitScale) / 2 - minX * fitScale,
        y: (stage.height() - (maxY - minY) * fitScale) / 2 - minY * fitScale
      });
      stage.batchDraw();
      return { width: stage.width(), height: stage.height(), scale: fitScale, nodeCount: cards.length };
    });
    await page.waitForTimeout(50);
    await page.screenshot({ path: resolve(artifactDir, 'representative-discovery-settled.png'), animations: 'disabled' });

    const roles = {
      localAnchor: 'Anchor',
      disconnectedAdvertisedPair: ['PairA', 'PairB'],
      isolatedAdvertisedEmpty: 'IsolatedEmpty',
      advertisedUnreadableWithRetainedWire: 'Unreadable',
      referencedNoRoute: 'NoRoute',
      namedOnlyExactLookupPeer: 'BindingPeer'
    };
    const evidence = {
      fixture: 'built local discovery representative: local anchor, disconnected ads, empty singleton, unreadable target, and exact-name lookup',
      screenshotViewport: { width: 1920, height: 1200 },
      screenshots: { initial: 'representative-discovery-initial.png', settled: 'representative-discovery-settled.png' },
      largeWorkloadEvidence: 'discovery-workload-450.json',
      roles,
      initial: { summary: initialSummary, counts: initialCounts, names: initialScene.names, visibleWires: initialScene.wireIds.length, camera: initialScene.camera },
      settled: {
        summary: settledSummary,
        counts: { ...settledCounts, noRoute: 1, unreachable: 1 },
        names: settledScene.names,
        actualRemoteGets: [...remoteGets].sort(),
        exactLookups: [...exactLookups].sort(),
        visibleWireCount: settledScene.wireIds.length,
        wireIds: settledScene.wireIds,
        expectedBindingWireIds: expectedWireIds,
        cameraBeforeScreenshotFit: settledScene.camera,
        anchorPositionBeforeScreenshotFit: settledScene.anchor,
        screenshotFrame
      }
    };
    const evidencePath = resolve(artifactDir, 'representative-discovery-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await test.info().attach('representative-discovery-evidence.json', { path: evidencePath, contentType: 'application/json' });
  } finally {
    inventoryRelease.release();
    exactLookupRelease.release();
  }
});

test('450-advertisement browser workload records physical concurrency, token-bucket starts, and settled counts', async ({ page }) => {
  test.setTimeout(140_000);
  const owners = Array.from({ length: 450 }, (_, index) => `Load${String(index).padStart(3, '0')}`);
  const localOwners = Array.from({ length: 4 }, (_, index) => `Local${String(index).padStart(3, '0')}`);
  const remoteStarts: number[] = [];
  const physicalStarts: number[] = [];
  const requested: string[] = [];
  const physicalRequests: string[] = [];
  let active = 0;
  let maxActive = 0;
  let inventoryAt = 0;
  const heldOwnerRelease = waitGate();
  const heldOwnerStarted = waitGate();
  const advertisedInventory = waitGate();
  const advertisedInventoryStarted = waitGate();
  // Record initiation in Chromium, not arrival at a Node route/server handler:
  // independent IPC delays can compress the observed first five arrivals.
  const browserStarts: number[] = [];
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable');
  network.on('Network.requestWillBeSent', ({ request, timestamp }) => {
    if (apiPath(new URL(request.url).pathname)) browserStarts.push(timestamp * 1000);
  });
  const remoteServer = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const owner = /^\/nodes\/(Load\d{3})\/REST\/remote$/.exec(path)?.[1];
    if (request.method !== 'GET' || !owner) { response.writeHead(404).end(); return; }
    const startedAt = performance.now();
    remoteStarts.push(startedAt);
    physicalStarts.push(startedAt);
    physicalRequests.push(`GET ${path}`);
    requested.push(owner);
    active += 1;
    maxActive = Math.max(maxActive, active);
    void (async () => {
      if (owner === 'Load001') {
        heldOwnerStarted.release();
        await heldOwnerRelease.promise;
      }
      await new Promise((resolve) => setTimeout(resolve, 8));
      response.setHeader('Access-Control-Allow-Origin', experimentOrigin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      const bindings = owner === 'Load000'
        ? JSON.stringify({ actions: { 'Power On': { node: 'Load001', action: 'Wake' } } })
        : '{}';
      response.writeHead(200).end(bindings);
      active -= 1;
    })();
  });
  const remoteOrigin = await listenLoopback(remoteServer);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === remoteOrigin) return route.continue();
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`450 fixture blocked unexpected origin ${url.origin}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    if (url.pathname === '/REST' && request.method() === 'GET') {
      inventoryAt = performance.now();
      physicalStarts.push(inventoryAt);
      physicalRequests.push('GET /REST');
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      await route.fulfill(jsonResponse({ nodes: Object.fromEntries(localOwners.map((name) => [name, {}])) }));
      active -= 1;
      return;
    }
    if (request.method() === 'GET' && /^\/nodes\/Local\d{3}\/REST\/remote$/.test(url.pathname)) {
      const startedAt = performance.now();
      physicalStarts.push(startedAt);
      physicalRequests.push(`GET ${url.pathname}`);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      await route.fulfill(jsonResponse({}));
      active -= 1;
      return;
    }
    if (url.pathname === '/REST/nodeURLs' && request.method() === 'POST') {
      const startedAt = performance.now();
      physicalStarts.push(startedAt);
      physicalRequests.push('POST /REST/nodeURLs');
      active += 1;
      maxActive = Math.max(maxActive, active);
      advertisedInventoryStarted.release();
      try {
        await advertisedInventory.promise;
        await route.fulfill(jsonResponse(owners.map((node) => ({ node, address: `${remoteOrigin}/nodes/${node}` }))));
      } finally {
        active -= 1;
      }
      return;
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected 450-workload request ${request.method()} ${url.pathname}`);
  });

  try {
    await page.goto('/topology-canvas.html?source=local');
    const summaryElement = page.locator('[data-fixture-summary]');
    await advertisedInventoryStarted.promise;
    await expect(summaryElement).toContainText('4 nodes · 4 complete');
    await expect(summaryElement).toContainText('HTTP inventory pending');
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: resolve(artifactDir, 'discovery-450-initial.png'), animations: 'disabled' });
    const initialProgress = (await summaryElement.textContent()) ?? '';
    advertisedInventory.release();
    await heldOwnerStarted.promise;
    await expect(summaryElement).toContainText('454 nodes', { timeout: 20_000 });
    await expect.poll(async () => page.evaluate(() => {
      type Shape = { find(selector: string): Shape[]; id(): string; getClientRect(): { x: number; y: number; width: number; height: number }; visible(): boolean; position(): { x: number; y: number }; width(): number; height(): number; scaleX(): number; scaleY(): number; batchDraw(): void };
      const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
      if (!stage) return 0;
      return stage.find('.topology-wire').filter((wire) => wire.visible()).length;
    })).toBeGreaterThan(0);
    const midWire = await page.evaluate(() => {
      type Shape = {
        find(selector: string): Shape[]; id(): string; text(): string; visible(): boolean;
        position(value?: { x: number; y: number }): { x: number; y: number } | void; width(): number; height(): number;
        scaleX(): number; scaleY(): number; batchDraw(): void;
        getClientRect(): { x: number; y: number; width: number; height: number };
      };
      const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('450-node stage disappeared before mid-progress evidence');
      const cards = stage.find('.topology-card');
      const namedCard = (name: string) => cards.find((card) => card.find('Text').some((text) => text.text() === name));
      const first = namedCard('Load000');
      const second = namedCard('Load001');
      if (!first || !second) throw new Error('Wire endpoints are not both in the live stage');
      const firstRect = first.getClientRect();
      const secondRect = second.getClientRect();
      const centerX = (firstRect.x + firstRect.width / 2 + secondRect.x + secondRect.width / 2) / 2;
      const centerY = (firstRect.y + firstRect.height / 2 + secondRect.y + secondRect.height / 2) / 2;
      stage.position({ x: stage.width() / 2 - centerX * stage.scaleX(), y: stage.height() / 2 - centerY * stage.scaleY() });
      stage.batchDraw();
      const wires = stage.find('.topology-wire').filter((wire) => wire.visible());
      const viewport = { width: stage.width(), height: stage.height() };
      return { wireCount: wires.length, visibleWireCount: wires.length, ids: wires.map((wire) => wire.id()).sort(), viewport };
    });
    expect(midWire.wireCount).toBeGreaterThan(0);
    expect(midWire.visibleWireCount).toBeGreaterThan(0);
    await expect.poll(() => summaryElement.textContent()).toContain('queued');
    await page.waitForTimeout(50);
    await page.screenshot({ path: resolve(artifactDir, 'discovery-450-mid.png'), animations: 'disabled' });
    const midProgress = (await summaryElement.textContent()) ?? '';
    heldOwnerRelease.release();
    await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled', { timeout: 130_000 });
    const elapsedMs = performance.now() - inventoryAt;
    const summary = (await summaryElement.textContent()) ?? '';
    const parseCounts = (text: string) => {
      const match = /(\d+) nodes · (\d+) complete · (\d+) partial · (\d+) queued · (\d+) terminal not inspected/.exec(text);
      if (!match) throw new Error(`Unrecognized progress summary: ${text}`);
      return {
        nodes: Number(match[1]),
        complete: Number(match[2]),
        partial: Number(match[3]),
        queued: Number(match[4]),
        terminalNotInspected: Number(match[5])
      };
    };
    const initialCounts = parseCounts(initialProgress);
    const midCounts = parseCounts(midProgress);
    const settledCounts = parseCounts(summary);
    const nativeTooltip = await summaryElement.getAttribute('title');
    const inventoryScopeTooltip = await page.locator('[data-inventory-scope]').getAttribute('title');
    await expect(summaryElement).toHaveAttribute('aria-live', 'off');
    await page.screenshot({ path: resolve(artifactDir, 'discovery-450-settled.png'), animations: 'disabled' });
    expect(maxActive).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(remoteStarts).toHaveLength(450);
    expect(physicalRequests).toHaveLength(456);
    expect(physicalStarts).toHaveLength(physicalRequests.length);
    expect(new Set(requested).size).toBe(requested.length);
    expect(midProgress).toContain('454 nodes');
    expect(midProgress).toContain('queued');
    expect(midCounts.nodes).toBe(454);
    expect(midCounts.queued).toBeGreaterThan(0);
    expect(midCounts.terminalNotInspected).toBe(0);
    expect(midWire.visibleWireCount).toBe(1);
    expect(summary).toContain('454 nodes · 454 complete · 0 partial · 0 queued · 0 terminal not inspected · inventory coverage complete · scheduler settled');
    expect(settledCounts).toEqual({ nodes: 454, complete: 454, partial: 0, queued: 0, terminalNotInspected: 0 });
    expect(elapsedMs).toBeGreaterThanOrEqual(100_000);
    expect(elapsedMs).toBeLessThan(130_000);
    expect(browserStarts).toHaveLength(physicalRequests.length);
    const sortedStarts = browserStarts.sort((a, b) => a - b);
    for (let index = 4; index < sortedStarts.length; index += 1) {
      // A capacity-four bucket allows four starts immediately; the fifth must
      // wait for one 250ms refill. Allow 10ms for timestamp resolution.
      expect(sortedStarts[index]! - sortedStarts[index - 4]!, `token-bucket five-start window at request ${index}`).toBeGreaterThanOrEqual(240);
    }
    const evidence = {
      workload: {
        advertisedOwners: owners.length,
        stageAOwners: localOwners.length,
        transport: 'real Chromium + separate loopback HTTP origin; no fake clock',
        screenshots: ['discovery-450-initial.png', 'discovery-450-mid.png', 'discovery-450-settled.png']
      },
      observed: {
        summary,
        measuredRemoteGetRatePerSecond: Number((remoteStarts.length / (elapsedMs / 1_000)).toFixed(3)),
        measuredTotalPhysicalStartRatePerSecond: Number((physicalRequests.length / (elapsedMs / 1_000)).toFixed(3)),
        progress: { initial: initialProgress, mid: midProgress, settled: summary },
        exactStageCounts: {
          initial: { ...initialCounts, visibleWires: 0 },
          mid: { ...midCounts, visibleWires: midWire.visibleWireCount, wireIds: midWire.ids, heldOwner: 'Load001' },
          settled: { ...settledCounts, visibleWires: midWire.visibleWireCount }
        },
        progressSummaryAccessibility: {
          role: await summaryElement.getAttribute('role'),
          ariaLive: await summaryElement.getAttribute('aria-live'),
          nativeTitleTooltip: nativeTooltip,
          inventoryScopeTooltip
        },
        observedUniqueRemoteGetStarts: remoteStarts.length,
        uniqueRequestedOwners: new Set(requested).size,
        maximumPhysicalConcurrency: maxActive,
        elapsedMs: Math.round(elapsedMs),
        physicalRequestCountAcrossStageAAndB: physicalRequests.length,
        physicalRequestKinds: physicalRequests.reduce<Record<string, number>>((counts, request) => ({ ...counts, [request.split(' ')[0]!]: (counts[request.split(' ')[0]!] ?? 0) + 1 }), {}),
        requestStartOffsetsMs: sortedStarts.map((at) => Math.round(at - sortedStarts[0]!)),
        sharedLimiterTokenBucketWindowCheck: 'for every sorted start i>=4, start[i]-start[i-4] >= 240ms; capacity=4 tokens, refill=1 token/250ms, 10ms timestamp tolerance'
      }
    };
    const evidencePath = resolve(artifactDir, 'discovery-workload-450.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await test.info().attach('discovery-workload-450.json', { path: evidencePath, contentType: 'application/json' });
  } finally {
    advertisedInventory.release();
    heldOwnerRelease.release();
    await closeServer(remoteServer);
  }
});

test('partially reconstructed remote assignments keep a distinct neutral host badge', async ({ page }) => {
  const partialBindings = { actions: {
    'Run Gamma': { node: 'Gamma', action: 'Run' },
    'run gamma': { node: 'Gamma', action: 'Stop' }
  } };
  const remote = startRemoteHost('allow', experimentOrigin, { Alpha: partialBindings, Beta: partialBindings });
  const remoteOrigin = await remote.listen();
  try {
    const local = await installExactEnrichmentFixture(page, remoteOrigin, [remoteOrigin], 1_200);
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await Promise.all([remote.started.Alpha.promise, remote.started.Beta.promise]);
    remote.arrivals.Alpha.release();
    remote.arrivals.Beta.release();
    await expect.poll(() => local.lookupNames.length).toBe(2);
    await expect(page.locator('[data-fixture-summary]')).toContainText('2 partial');

    const cards = await page.evaluate(() => {
      type Shape = { name(): string; text(): string; find(selector: string): Shape[]; getAttr(name: string): unknown };
      type Stage = Shape & { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      if (!stage) throw new Error('Konva stage unavailable after partial remote reconstruction');
      return stage.find('.topology-card').map((card) => {
        const texts = card.find('Text').map((text) => text.text());
        const title = texts.find((text) => ['Owner', 'Alpha', 'Beta'].includes(text));
        const host = card.find('Group').find((group) => group.name().startsWith('host-location-'));
        return { title, texts, host: host?.name(), description: card.getAttr('accessibleDescription') };
      });
    });
    for (const name of ['Alpha', 'Beta']) {
      const card = cards.find(({ title }) => title === name);
      expect(card?.texts).toContain('Bindings partially loaded');
      expect(card?.host).toBe('host-location-remote');
      expect(card?.description).toContain(`Advertised host: ${new URL(remoteOrigin).host}.`);
      expect(card?.description).toContain('Bindings partially loaded.');
      expect(card?.description).not.toMatch(/\b\d+ set, \d+ unset of \d+ bindings/);
      expect(card?.description).not.toContain('none unassigned');
      expect(card?.description).not.toContain('http');
      expect(card?.description).not.toContain('/nodes/');
    }
    expect(remote.requests.map(({ pathname }) => pathname).sort()).toEqual(['/nodes/Alpha/REST/remote', '/nodes/Beta/REST/remote']);
    expect(local.lookupNames.sort()).toEqual(['Alpha', 'Beta']);
  } finally {
    await remote.close();
  }
});

test('selected real wire survives enrichment under native pan and zoom', async ({ page }) => {
  const remote = startRemoteHost('allow', experimentOrigin);
  const remoteOrigin = await remote.listen();
  try {
    await installKonvaDrawProbe(page);
    const local = await installExactEnrichmentFixture(page, remoteOrigin, [remoteOrigin], 1_200);
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await expect(page.locator('[data-fixture-summary]')).toContainText('3 nodes');
    await Promise.all([remote.started.Alpha.promise, remote.started.Beta.promise]);

    const initialCamera = (await inspectKonvaScene(page, true)).camera;
    const canvas = page.locator('.canvas-stage canvas').last();
    const wheelAtCanvasCenter = async (deltaY: number) => {
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error('Konva canvas unavailable for native wheel');
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, deltaY);
      await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
    };
    const dragBackground = async (delta: { x: number; y: number }, steps: number) => {
      const path = await findCanvasBackgroundDrag(page, delta, steps);
      await page.mouse.move(path.from.x, path.from.y);
      await page.mouse.down();
      await page.mouse.move(path.to.x, path.to.y, { steps });
      await page.mouse.up();
      return path;
    };
    // Exercise the actual stage handlers with bounded real input before the
    // per-owner 3-second transport deadline: wheel zoom, empty-space pan, wire hit.
    await wheelAtCanvasCenter(-420);
    const panBeforePatch = await dragBackground({ x: 62, y: 41 }, 2);
    const pannedZoomedCamera = (await inspectKonvaScene(page)).camera;
    expect(pannedZoomedCamera.scaleX).not.toBe(initialCamera.scaleX);
    expect(pannedZoomedCamera.x).not.toBe(initialCamera.x);
    expect(pannedZoomedCamera.y).not.toBe(initialCamera.y);

    const unselectedWire = await findWireHit(page, ['Owner', 'Alpha']);
    expect(unselectedWire.hitId).toBe(unselectedWire.wireId);
    await page.mouse.click(unselectedWire.screen.x, unselectedWire.screen.y);
    const selectedWire = await findWireHit(page, ['Owner', 'Alpha']);
    expect(selectedWire.wireId).toBe(unselectedWire.wireId);
    expect(selectedWire.source.stroke).toBe(selectedWire.selectedStroke);
    expect(selectedWire.target.stroke).toBe(selectedWire.selectedStroke);
    expect(selectedWire.source.connectionSelected).toBe(true);
    expect(selectedWire.target.connectionSelected).toBe(true);

    const sceneBeforePatch = await inspectKonvaScene(page, true);
    expect(sceneBeforePatch.cardPositions).toHaveProperty('Alpha');
    expect(sceneBeforePatch.cardPositions).toHaveProperty('Beta');

    const betaVisible = page.evaluate(() => {
      const probe = (window as Window & { __konvaDrawProbe?: { waitForPatch(ownerName: 'Beta'): Promise<{ responseEndAt: number; visibleAt: number; method: string }> } }).__konvaDrawProbe;
      if (!probe) throw new Error('Konva draw probe is unavailable');
      return probe.waitForPatch('Beta');
    });
    const alphaVisible = page.evaluate(() => {
      const probe = (window as Window & { __konvaDrawProbe?: { waitForPatch(ownerName: 'Alpha'): Promise<{ responseEndAt: number; visibleAt: number; method: string }> } }).__konvaDrawProbe;
      if (!probe) throw new Error('Konva draw probe is unavailable');
      return probe.waitForPatch('Alpha');
    });
    remote.arrivals.Beta.release();
    remote.arrivals.Alpha.release();
    await Promise.all([betaVisible, alphaVisible]);
    await expect.poll(() => readCardDescription(page, 'Beta')).toContain(`Advertised host: ${new URL(remoteOrigin).host}.`);
    await expect.poll(() => readCardDescription(page, 'Alpha')).toContain('Inspection succeeded;');
    await expect.poll(() => readCardDescription(page, 'Beta')).toContain('Inspection succeeded;');

    const sceneAfterPatch = await inspectKonvaScene(page);
    expect(sceneAfterPatch.camera).toEqual({ ...sceneBeforePatch.camera, ...centeredTranslation(sceneBeforePatch.viewport, sceneAfterPatch.viewport, sceneBeforePatch.camera.x, sceneBeforePatch.camera.y) });
    expect(sceneAfterPatch.cardNames).toEqual(['Alpha', 'Beta', 'Gamma', 'Owner']);
    expect(sceneAfterPatch.cardPositions.Alpha).toEqual(sceneBeforePatch.cardPositions.Alpha);
    expect(sceneAfterPatch.cardPositions.Beta).toEqual(sceneBeforePatch.cardPositions.Beta);
    // Known-host badge glyphs are replaced as unresolved locations become
    // confirmed; the diagram's remaining existing leaf shapes still survive.
    expect(sceneAfterPatch.retainedShapes).toBeGreaterThan(sceneBeforePatch.shapeCount / 2);
    expect(sceneAfterPatch.retainedShapes).toBe(sceneBeforePatch.shapeCount);
    expect(sceneAfterPatch.touchedShapes + sceneAfterPatch.addedShapes).toBeLessThan(sceneBeforePatch.shapeCount);
    const wireAfterPatch = await findWireHit(page, ['Owner', 'Alpha']);
    expect(wireAfterPatch.wireId).toBe(selectedWire.wireId);
    expect(wireAfterPatch.source.socketId).toBe(selectedWire.source.socketId);
    expect(wireAfterPatch.target.socketId).toBe(selectedWire.target.socketId);
    expect(wireAfterPatch.source.stroke).toBe(selectedWire.selectedStroke);
    expect(wireAfterPatch.target.stroke).toBe(selectedWire.selectedStroke);
    expect(wireAfterPatch.source.connectionSelected).toBe(true);
    expect(wireAfterPatch.target.connectionSelected).toBe(true);
    const identity = await page.evaluate(() => {
      type Shape = { id(): string; name(): string; find(selector: string): Shape[]; text(): string };
      type Stage = Shape & { find(selector: string): Shape[] };
      const state = window as Window & {
        Konva?: { stages?: Stage[] };
        __enrichmentRefs?: { stage: Stage; cards: Map<string, Shape>; sockets: Map<string, Shape>; wires: Map<string, Shape> };
      };
      const stage = state.Konva?.stages?.[0];
      const before = state.__enrichmentRefs;
      if (!stage || !before) throw new Error('Selected wire identity baseline was not saved');
      const cards = new Map(stage.find('.topology-card').map((card): [string, Shape] => [
        card.find('Text').map((text) => text.text()).find((name) => ['Owner', 'Alpha', 'Beta', 'Gamma'].includes(name)) ?? '', card
      ]));
      const sockets = new Map<string, Shape>();
      for (const [owner, card] of cards) for (const socket of card.find('Circle').filter((shape) => shape.name().startsWith('socket-'))) sockets.set(`${owner}:${socket.name()}`, socket);
      const wires = new Map(stage.find('.topology-wire').map((wire): [string, Shape] => [wire.id(), wire]));
      const retained = (prior: Map<string, Shape>, current: Map<string, Shape>) => [...prior].every(([key, shape]) => current.get(key) === shape);
      return { stage: stage === before.stage, cards: retained(before.cards, cards), sockets: retained(before.sockets, sockets), wires: retained(before.wires, wires) };
    });
    expect(identity).toEqual({ stage: true, cards: true, sockets: true, wires: true });
    const after = await page.screenshot({ path: resolve(artifactDir, 'enrichment-selected-wire-after.png'), animations: 'disabled' });
    await test.info().attach('enrichment-selected-wire-after.png', { body: after, contentType: 'image/png' });

    // Native wheel and stage-drag pan still operate after enrichment, without clearing selected wire/socket state.
    await wheelAtCanvasCenter(300);
    const afterWheel = (await inspectKonvaScene(page)).camera;
    expect(afterWheel.scaleX).not.toBe(sceneAfterPatch.camera.scaleX);
    const panAfterPatch = await dragBackground({ x: -45, y: 35 }, 5);
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
    const sceneAfterGestures = await inspectKonvaScene(page);
    const afterNativeGestures = sceneAfterGestures.camera;
    expect(afterNativeGestures.x - afterWheel.x).toBeCloseTo(-45);
    expect(afterNativeGestures.y - afterWheel.y).toBeCloseTo(35);
    expect(afterNativeGestures.scaleX).toBe(afterWheel.scaleX);
    expect(afterNativeGestures.scaleY).toBe(afterWheel.scaleY);
    expect(sceneAfterGestures.cardPositions).toEqual(sceneAfterPatch.cardPositions);
    const wireAfterGestures = await findWireHit(page, ['Owner', 'Alpha']);
    expect(wireAfterGestures.wireId).toBe(selectedWire.wireId);
    expect(wireAfterGestures.source.stroke).toBe(selectedWire.selectedStroke);
    expect(wireAfterGestures.target.stroke).toBe(selectedWire.selectedStroke);

    const probeMetrics = await page.evaluate(() => {
      const probe = (window as Window & {
        __konvaDrawProbe?: {
          firstDrawAt?: number;
          patches: Partial<Record<'Alpha' | 'Beta', { responseEndAt: number; visibleAt: number; method: string }>>;
        };
      }).__konvaDrawProbe;
      if (!probe?.firstDrawAt || !probe.patches.Alpha || !probe.patches.Beta) throw new Error('Event-driven paint metrics are incomplete');
      return {
        initialMountFirstActualKonvaDrawAtMs: probe.firstDrawAt,
        betaCompletionToVisibleDrawMs: probe.patches.Beta.visibleAt - probe.patches.Beta.responseEndAt,
        alphaCompletionToVisibleDrawMs: probe.patches.Alpha.visibleAt - probe.patches.Alpha.responseEndAt,
        betaDrawMethod: probe.patches.Beta.method,
        alphaDrawMethod: probe.patches.Alpha.method
      };
    });
    const metrics = {
      ...probeMetrics,
      initialMountedShapes: sceneBeforePatch.shapeCount,
      retainedExistingShapes: sceneAfterPatch.retainedShapes,
      touchedExistingShapes: sceneAfterPatch.touchedShapes,
      insertedShapes: sceneAfterPatch.addedShapes,
      selectedWireId: selectedWire.wireId,
      cameraBeforePatch: sceneBeforePatch.camera,
      panBeforePatch,
      cameraAfterWheel: afterWheel,
      panAfterPatch,
      cameraAfterPan: afterNativeGestures
    };
    await test.info().attach('selected-wire-enrichment-metrics.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    await writeFile(resolve(artifactDir, 'selected-wire-enrichment-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    expect(local.lookupNames.sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(remote.requests.map(({ pathname }) => pathname).sort()).toEqual(['/nodes/Alpha/REST/remote', '/nodes/Beta/REST/remote']);
    expect(remote.requests.every(({ origin, cookie }) => origin === experimentOrigin && cookie === undefined)).toBe(true);
  } finally {
    await remote.close();
  }
});

test('late loopback events grow Dense from 2 to 22 ports on one side and preserve its neighbour', async ({ page }) => {
  const additions = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 3).padStart(2, '0');
    return [`Listen ${number}`, { node: 'Dense', event: `Input ${number}` }];
  }));
  const lateResponse = waitGate();
  const remoteStarted = waitGate();
  const remote = createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method !== 'GET' || pathname !== '/nodes/GrowthOwner/REST/remote') { response.writeHead(404).end(); return; }
    response.setHeader('Access-Control-Allow-Origin', experimentOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    remoteStarted.release();
    void lateResponse.promise.then(() => response.writeHead(200).end(JSON.stringify({ events: additions })));
  });
  const remoteOrigin = await listenLoopback(remote);
  const localRequests: RequestRecord[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === remoteOrigin) return route.continue();
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`Late-growth fixture blocked external request ${url.origin}`);
    }
    if (!apiPath(url.pathname)) return route.continue();
    localRequests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (request.method() === 'GET' && url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Dense: {}, Neighbour: {} } }));
    if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
      return route.fulfill(jsonResponse([{ node: 'GrowthOwner', address: `${remoteOrigin}/nodes/GrowthOwner` }]));
    }
    if (request.method() === 'GET' && url.pathname === '/nodes/Dense/REST/remote') return route.fulfill(jsonResponse({}));
    if (request.method() === 'GET' && url.pathname === '/nodes/Neighbour/REST/remote') {
      return route.fulfill(jsonResponse({ events: {
        'Listen 01': { node: 'Dense', event: 'Input 01' },
        'Listen 02': { node: 'Dense', event: 'Input 02' }
      } }));
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected late-growth API request ${request.method()} ${url.pathname}`);
  });
  const snapshot = () => page.evaluate(() => {
    type Point = { x: number; y: number };
    type Rect = { x: number; y: number; width: number; height: number };
    type Shape = {
      id(): string; text(): string; name(): string; x(): number; y(): number; width(): number; height(): number;
      find(selector: string): Shape[]; getAbsolutePosition(top?: Shape): Point;
      getClientRect(config?: { relativeTo?: Shape }): Rect;
    };
    type Stage = Shape & { find(selector: string): Shape[] };
    type Refs = { stage: Stage; dense: Shape; neighbour: Shape; wires: Map<string, Shape> };
    const state = window as Window & { Konva?: { stages?: Stage[] }; __lateGrowthRefs?: Refs };
    const stage = state.Konva?.stages?.[0];
    if (!stage) throw new Error('Late-growth stage is unavailable');
    const cardByName = (name: string) => stage.find('.topology-card').find((card) => card.find('Text').some((text) => text.text() === name));
    const dense = cardByName('Dense');
    const neighbour = cardByName('Neighbour');
    if (!dense || !neighbour) throw new Error('Dense or Neighbour card is missing');
    const growthOwner = (wireId: string) => {
      if (!wireId.startsWith('e-')) return false;
      const encoded = wireId.slice(2);
      let json = '';
      for (let i = 0; i < encoded.length; i += 4) json += String.fromCharCode(Number.parseInt(encoded.slice(i, i + 4), 16));
      try { return (JSON.parse(json) as unknown[])[1] === 'simple:growthowner'; } catch { return false; }
    };
    const growthWires = new Map(stage.find('.topology-wire').filter((wire) => growthOwner(wire.id())).map((wire): [string, Shape] => [wire.id(), wire]));
    const initialWires = new Map(stage.find('.topology-wire').map((wire): [string, Shape] => [wire.id(), wire]));
    const bounds = (card: Shape) => card.getClientRect({ relativeTo: stage });
    const denseBounds = bounds(dense);
    const neighbourBounds = bounds(neighbour);
    let leftSockets = 0;
    let rightSockets = 0;
    for (const socket of dense.find('Circle').filter((item) => item.name().startsWith('socket-'))) {
      if (socket.getAbsolutePosition(stage).x < denseBounds.x + denseBounds.width / 2) leftSockets += 1;
      else rightSockets += 1;
    }
    if (!state.__lateGrowthRefs) state.__lateGrowthRefs = { stage, dense, neighbour, wires: initialWires };
    const overlaps = denseBounds.x < neighbourBounds.x + neighbourBounds.width && denseBounds.x + denseBounds.width > neighbourBounds.x &&
      denseBounds.y < neighbourBounds.y + neighbourBounds.height && denseBounds.y + denseBounds.height > neighbourBounds.y;
    const retainedWires = [...state.__lateGrowthRefs.wires].every(([id, wire]) => initialWires.get(id) === wire);
    return {
      growthWireCount: growthWires.size,
      growthWireIds: [...growthWires.keys()].sort(),
      dense: { id: dense.id(), bounds: denseBounds, height: denseBounds.height, leftSockets, rightSockets },
      neighbour: { id: neighbour.id(), bounds: neighbourBounds },
      overlaps,
      sameStage: stage === state.__lateGrowthRefs.stage,
      sameDense: dense === state.__lateGrowthRefs.dense,
      sameNeighbour: neighbour === state.__lateGrowthRefs.neighbour,
      retainedWires
    };
  });
  try {
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await remoteStarted.promise;
    await expect.poll(async () => {
      const state = await snapshot();
      return state.dense.leftSockets + state.dense.rightSockets;
    }).toBe(2);
    const before = await snapshot();
    expect(before.growthWireCount).toBe(0);
    expect(Math.max(before.dense.leftSockets, before.dense.rightSockets)).toBe(2);
    expect(before.overlaps).toBe(false);
    await mkdir(resolve(artifactDir, 'preview-acceptance'), { recursive: true });
    const beforePath = resolve(artifactDir, 'preview-acceptance/dense-growth-before-2.png');
    const beforeImage = await page.screenshot({ path: beforePath, animations: 'disabled' });
    await test.info().attach('dense-growth-before-2.png', { body: beforeImage, contentType: 'image/png' });

    lateResponse.release();
    await expect.poll(async () => (await snapshot()).growthWireCount).toBe(20);
    await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
    await page.getByRole('button', { name: 'Reset view' }).click();
    const denseCenter = await page.evaluate(() => {
      type Shape = { text(): string; find(selector: string): Shape[]; getAbsolutePosition(top?: Shape): { x: number; y: number }; width(): number; height(): number };
      type Stage = Shape & { find(selector: string): Shape[]; getContent(): HTMLElement; x(): number; y(): number; scaleX(): number; scaleY(): number };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const dense = stage?.find('.topology-card').find((card) => card.find('Text').some((text) => text.text() === 'Dense'));
      const title = dense?.find('Text').find((text) => text.text() === 'Dense');
      if (!stage || !title) throw new Error('Dense title unavailable for port chooser');
      const position = title.getAbsolutePosition(stage);
      const rect = stage.getContent().getBoundingClientRect();
      return { x: rect.left + stage.x() + (position.x + title.width() / 2) * stage.scaleX(), y: rect.top + stage.y() + (position.y + title.height() / 2) * stage.scaleY() };
    });
    await page.mouse.click(denseCenter.x, denseCenter.y);
    await page.locator('.canvas-stage').focus();
    await page.keyboard.press('p');
    const denseButton = page.getByRole('button', { name: /Dense: Ports and bindings/ });
    await expect(denseButton).toContainText('+20');
    await denseButton.click();
      const chooser = page.getByRole('dialog', { name: /^Connection details/ });
    await expect(chooser).toBeVisible();
    await expect(chooser.locator('.canvas-binding-node-name')).toHaveText('Dense');
    await expect(chooser.getByText('22 bindings')).toBeVisible();
    await expect(chooser.getByRole('button', { name: 'Right overflow: 20 hidden ports' })).toBeVisible();
    await chooser.getByRole('button', { name: 'Expand ports' }).click();
    await expect(chooser.getByText('Not enough room to expand. Move this card away from its neighbours and try again.')).toBeVisible();
    const after = await snapshot();
    expect(after.sameStage).toBe(true);
    expect(after.sameDense).toBe(true);
    expect(after.sameNeighbour).toBe(true);
    expect(after.retainedWires).toBe(true);
    expect(after.growthWireCount).toBe(20);
    expect(after.dense.rightSockets).toBe(before.dense.rightSockets);
    expect(after.dense.leftSockets).toBe(before.dense.leftSockets);
    expect(after.overlaps).toBe(false);
    await chooser.getByRole('button', { name: 'Close' }).click();
    const afterPath = resolve(artifactDir, 'preview-acceptance/dense-growth-after-22.png');
    const afterImage = await page.screenshot({ path: afterPath, animations: 'disabled' });
    await test.info().attach('dense-growth-after-22.png', { body: afterImage, contentType: 'image/png' });
    expect(localRequests.filter(({ method, pathname }) => method === 'POST' && pathname === '/REST/nodeURLs')).toHaveLength(1);
  } finally {
    lateResponse.release();
    await closeServer(remote);
  }
});

for (const mode of ['deny', 'redirect'] as const) {
  test(`built remote fetch rejects real loopback CORS ${mode} responses without following redirects`, async ({ page }) => {
    const remote = startRemoteHost(mode, experimentOrigin);
    const remoteOrigin = await remote.listen();
    try {
      const local = await installExactEnrichmentFixture(page, remoteOrigin);
      await page.goto('/topology-canvas.html?source=local');
      await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
      await expect(page.locator('[data-fixture-summary]')).toContainText('3 nodes');
      await expect(page.locator('[data-fixture-summary]')).toContainText('2 unreachable');
      const unreadableHeaders = await page.evaluate(() => {
        type Shape = { name(): string; text(): string; find(selector: string): Shape[]; getAttr(name: string): unknown };
        type Stage = Shape & { find(selector: string): Shape[] };
        const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
        if (!stage) throw new Error('Konva stage unavailable after unreadable remote responses');
        return stage.find('.topology-card').map((card) => {
          const texts = card.find('Text').map((text) => text.text());
          const title = texts.find((text) => ['Owner', 'Alpha', 'Beta'].includes(text));
          const host = card.find('Group').find((group) => group.name().startsWith('host-location-'));
          return { title, texts, host: host?.name(), description: card.getAttr('accessibleDescription') };
        });
      });
      for (const name of ['Alpha', 'Beta']) {
        const card = unreadableHeaders.find(({ title }) => title === name);
        expect(card?.host).toBe('host-location-remote');
        expect(card?.description).toContain(`Advertised host: ${new URL(remoteOrigin).host}.`);
        expect(card?.description).toContain('Unreachable from this view');
        expect(card?.description).not.toContain('http');
      }
      expect(local.lookupNames.sort()).toEqual(['Alpha', 'Beta']);
      expect(remote.requests.map(({ pathname }) => pathname).sort()).toEqual([
        '/nodes/Alpha/REST/remote', '/nodes/Beta/REST/remote'
      ]);
      expect(remote.requests.some(({ pathname }) => pathname === '/redirect-target')).toBe(false);
      expect(local.requests.every(({ method }) => method === 'GET' || method === 'POST')).toBe(true);
    } finally {
      await remote.close();
    }
  });
}

test('built HTTPS local mode blocks an advertised HTTP loopback enrichment route as mixed content', async ({ browser }) => {
  const secure = await startBuiltHttpsPreview();
  const remote = startRemoteHost('allow', secure.origin);
  const remoteOrigin = await remote.listen();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const lookupNames: string[] = [];
  const localRequests: string[] = [];
  try {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== secure.origin) {
        await route.abort('blockedbyclient');
        throw new Error(`HTTPS loopback fixture blocked an unplanned origin ${url.origin}`);
      }
      if (!apiPath(url.pathname)) {
        await route.continue();
        return;
      }
      if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
        await route.fulfill(jsonResponse([]));
        return;
      }
      localRequests.push(`${request.method()} ${url.pathname}`);
      if (url.pathname === '/REST' && request.method() === 'GET') {
        await route.fulfill(jsonResponse({ nodes: { Owner: {} } }));
      } else if (url.pathname === '/nodes/Owner/REST/remote' && request.method() === 'GET') {
        await route.fulfill(jsonResponse({ actions: { 'Call Alpha': { node: 'Alpha', action: 'Prepare' } } }));
      } else if (url.pathname === '/REST/nodeURLsForNode' && request.method() === 'POST') {
        const body = request.postDataJSON() as { name?: unknown };
        if (body.name !== 'Alpha') throw new Error(`Mixed-content fixture discovered outside frozen worklist: ${String(body.name)}`);
        lookupNames.push('Alpha');
        await route.fulfill(jsonResponse([{ node: 'Alpha', address: `${remoteOrigin}/nodes/Alpha` }]));
      } else {
        await route.abort('blockedbyclient');
        throw new Error(`Unexpected HTTPS local API request ${request.method()} ${url.pathname}`);
      }
    });
    await page.goto(`${secure.origin}/topology-canvas.html?source=local`);
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    await expect(page.locator('[data-fixture-summary]')).toContainText('1 route blocked');
    expect(lookupNames).toEqual(['Alpha']);
    expect(localRequests.sort()).toEqual(['GET /REST', 'GET /nodes/Owner/REST/remote', 'POST /REST/nodeURLsForNode'].sort());
    // The page is genuinely HTTPS and the controlled second origin is HTTP;
    // policy must quarantine it before the browser can issue mixed content.
    expect(new URL(remoteOrigin).protocol).toBe('http:');
    expect(new URL(page.url()).protocol).toBe('https:');
    expect(remote.requests).toEqual([]);
  } finally {
    await page.close();
    await context.close();
    await remote.close();
    await secure.close();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`selects two coincident overflow bindings by pointer and keyboard in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const aliases = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [
      `Alias ${String(i + 1).padStart(2, '0')}`, { node: 'Receiver', action: 'Shared Input' }
    ]));
    await page.route((url) => url.origin === experimentOrigin && url.pathname.includes('/REST'), async route => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === '/REST' && method === 'GET') await route.fulfill(jsonResponse({ nodes: { Dense: {}, Receiver: {} } }));
      else if (path === '/REST/nodeURLs' && method === 'POST') await route.fulfill(jsonResponse([]));
      else if (path === '/nodes/Dense/REST/remote' && method === 'GET') await route.fulfill(jsonResponse({ actions: aliases }));
      else if (path === '/nodes/Receiver/REST/remote' && method === 'GET') await route.fulfill(jsonResponse({}));
      else throw new Error(`Unexpected overflow fixture request: ${method} ${path}`);
    });
    await page.goto('/topology-canvas.html?source=local');
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    const snapshot = () => page.evaluate(() => {
      type Native = {
        id(): string; x(): number; y(): number; width(): number; height(): number; visible(): boolean; scaleX(): number;
        name(): string; text(): string; find(selector: string): Native[]; getContent(): HTMLElement;
        getAbsolutePosition(): { x: number; y: number };
        getSceneFunc(): (ctx: Record<string, unknown>, self: Native) => void;
      };
      const stage = (window as Window & { Konva?: { stages?: Native[] } }).Konva?.stages?.[0];
      if (!stage) return;
      const card = stage.find('.topology-card').find(node => node.find('Text').some(text => text.text() === 'Dense'));
      const rail = card?.find('.overflow-rail-right')[0];
      if (!card || !rail) return;
      const position = rail.getAbsolutePosition();
      const bounds = stage.getContent().getBoundingClientRect();
      const wires = stage.find('.topology-wire');
      return {
        pointer: { x: bounds.left + position.x - 23 * stage.scaleX(), y: bounds.top + position.y + 15 * stage.scaleX() },
        camera: [stage.x(), stage.y(), stage.scaleX()],
        card: [card.x(), card.y(), card.find('Rect')[0]?.height()],
        sockets: card.find('Circle').filter(socket => socket.name().startsWith('socket-')).length,
        bottomRail: rail.visible(),
        wireCount: wires.length,
         selected: document.querySelector('.canvas-failure')?.textContent ?? ''
      };
    });
    await expect.poll(async () => (await snapshot())?.wireCount).toBe(24);
    await expect(page.getByRole('button', { name: 'Show now' })).toBeHidden();
    await expect(page.locator('[data-topology-scrim]')).toBeHidden();
    const initial = (await snapshot())!;
    expect(initial.bottomRail).toBe(true);
    expect(initial.sockets).toBeLessThan(16);
    await page.mouse.click(initial.pointer.x, initial.pointer.y);
    const chooser = page.getByRole('dialog', { name: /^Connection details/ });
    await expect(chooser).toBeVisible();
    await expect(chooser.locator('.canvas-binding-node-name')).toHaveText('Dense');
    await expect(chooser.getByText(/hidden ports · \d+ bindings/)).toBeVisible();
    const first = chooser.locator('[data-binding-id]').first();
    const firstId = await first.getAttribute('data-binding-id');
    const firstAlias = await first.locator('.canvas-binding-endpoint-name').first().textContent();
    await first.click();
    await expect.poll(async () => (await snapshot())?.selected).toContain(firstAlias);

    const dragStart = { x: initial.pointer.x - 85, y: initial.pointer.y - 20 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 24, dragStart.y - 14, { steps: 6 });
    await page.mouse.up();
    const dragged = (await snapshot())!;
    expect(dragged.card.slice(0, 2)).not.toEqual(initial.card.slice(0, 2));
    expect(dragged.card[2]).toBe(initial.card[2]);
    expect(dragged.selected).toContain(firstAlias);

    await page.keyboard.press('p');
    const keyboardChooser = page.getByRole('dialog', { name: /^Connection details/ });
    await expect(keyboardChooser).toBeVisible();
    await keyboardChooser.getByRole('button', { name: /Right overflow/ }).focus();
    await page.keyboard.press('Enter');
    await expect(chooser).toBeVisible();
    await page.keyboard.press('PageDown');
    await expect(chooser.getByText(/Page 2 of [23]/)).toBeVisible();
    const secondId = await chooser.locator('[data-binding-id]').first().getAttribute('data-binding-id');
    const secondAlias = await chooser.locator('[data-binding-id]').first().locator('.canvas-binding-endpoint-name').first().textContent();
    expect(secondId).not.toBe(firstId);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await snapshot())?.selected).toContain(secondAlias);
    const after = (await snapshot())!;
    expect(after.camera).toEqual(initial.camera);
    expect(after.card).toEqual(dragged.card);
    await expect(page.locator('.canvas-stage')).toBeFocused();

    await page.keyboard.press('p');
    await keyboardChooser.getByRole('button', { name: 'Expand ports' }).click();
    await expect(keyboardChooser.getByText('Ports expanded.')).toBeVisible();
    expect((await snapshot())?.sockets).toBe(16);
    await keyboardChooser.getByRole('button', { name: 'Compact ports' }).click();
    await expect(keyboardChooser.getByText('Ports compacted.')).toBeVisible();
    await page.keyboard.press('Escape');
    const compact = (await snapshot())!;
    expect(compact.card).toEqual(dragged.card);
    expect(compact.camera).toEqual(initial.camera);
    expect(compact.selected).toContain(secondAlias);
  });
}

test('arbitrates wheel zoom and preserves camera and layout during dense port paging', async ({ browser }, testInfo) => {
  const mode = process.env.KONVA_PORT_WINDOW_TEST_MODE ?? 'chooser';
  const context = await browser.newContext({ baseURL: experimentOrigin, viewport: { width: 1366, height: 768 }, hasTouch: true });
  const page = await context.newPage();
  try {
    const aliases = (prefix: string, kind: 'event' | 'action') => Object.fromEntries(Array.from({ length: 32 }, (_, i) => [
      `${prefix} ${String(i).padStart(2, '0')}`, { node: 'Peer', [kind]: `Shared ${kind}` }
    ]));
    await page.route((url) => url.origin === experimentOrigin && url.pathname.includes('/REST'), async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/REST') await route.fulfill(jsonResponse({ nodes: { Dense: {}, Peer: {} } }));
      else if (pathname === '/REST/nodeURLs') await route.fulfill(jsonResponse([]));
      else if (pathname === '/nodes/Dense/REST/remote') await route.fulfill(jsonResponse({ actions: aliases('Outbound', 'action'), events: aliases('Inbound', 'event') }));
      else if (pathname === '/nodes/Peer/REST/remote') await route.fulfill(jsonResponse({}));
      else throw new Error(`Unexpected port-window fixture request: ${pathname}`);
    });
    await page.goto('/topology-canvas.html?source=local');
    const snapshot = () => page.evaluate(() => {
      type Native = {
        _id: number;
        x(): number; y(): number; scaleX(): number; name(): string; text(): string; radius(): number;
        find(selector: string): Native[]; getContent(): HTMLElement; isVisible(): boolean;
        getAbsoluteTransform(): { point(point: { x: number; y: number }): { x: number; y: number } };
        getAttr(key: string): unknown;
      };
      const stage = (window as Window & { Konva?: { stages?: Native[] } }).Konva?.stages?.[0];
      const card = stage?.find('.topology-card').find(node => node.find('Text').some(text => text.text() === 'Dense'));
      if (!stage || !card) return;
      const rect = stage.getContent().getBoundingClientRect();
      const point = (x: number, y: number, node = card) => {
        const p = node.getAbsoluteTransform().point({ x, y });
        return { x: rect.x + p.x, y: rect.y + p.y };
      };
      const sockets = (side: 'left' | 'right') => card.find('Circle').filter(node => node.name().startsWith('socket-') && (node.x() === 0) === (side === 'left'));
      const rail = (name: string) => card.find(name)[0];
      const top = rail('.overflow-rail-right-above');
      const bottom = rail('.overflow-rail-right');
      return {
        camera: [stage.x(), stage.y(), stage.scaleX()], card: [card.x(), card.y()], wireCount: stage.find('.topology-wire').length,
        left: sockets('left').map(node => node.getAttr('accessibleDescription')),
        right: sockets('right').map(node => node.getAttr('accessibleDescription')),
        rightNative: sockets('right').map(node => node._id),
        top: top?.isVisible() ? top.find('Text')[0]?.text() : undefined,
        bottom: bottom?.isVisible() ? bottom.find('Text')[0]?.text() : undefined,
         selected: document.querySelector('.canvas-failure')?.textContent ?? '',
        pageBack: top?.isVisible() ? point(-46, 14, top) : undefined,
        belowChevron: bottom?.isVisible() ? point(-46, 14, bottom) : undefined,
        openBelow: bottom?.isVisible() ? point(-23, 11, bottom) : undefined,
        onHeader: point(95, 47), onLeft: point(52, 130), onRight: point(152, 130)
      };
    });
    await expect.poll(async () => (await snapshot())?.wireCount).toBe(64);
    await expect(page.locator('[data-topology-scrim]')).toBeHidden();
    const initial = (await snapshot())!;
    expect(initial.right[0]).toBe('Outbound 00');
    expect(initial.left[0]).toBe('Inbound 00');
    expect(initial.top).toBeUndefined();
    expect(initial.bottom).toMatch(/^\d+$/);
    if (mode === 'chooser') {
      await page.mouse.move(initial.onRight.x, initial.onRight.y);
      await page.mouse.wheel(0, initial.camera[2]! > 1 ? 24 : -24);
      await expect.poll(async () => (await snapshot())?.camera[2]).not.toBe(initial.camera[2]);
      const zoomed = (await snapshot())!;
      expect(zoomed.right).toEqual(initial.right);
      expect(zoomed.left).toEqual(initial.left);

      await page.touchscreen.tap(zoomed.belowChevron!.x, zoomed.belowChevron!.y);
      await expect.poll(async () => (await snapshot())?.right[0]).toBe(`Outbound ${String(initial.right.length).padStart(2, '0')}`);
      const paged = (await snapshot())!;
      expect(paged.left).toEqual(initial.left);
      expect(paged.rightNative).toEqual(initial.rightNative);
      expect(paged.camera).toEqual(zoomed.camera);
      await expect(page.getByRole('dialog')).toBeHidden();

      const count = paged.openBelow!;
      await page.touchscreen.tap(count.x, count.y);
      const chooser = page.getByRole('dialog', { name: /^Connection details/ });
      await expect(chooser).toBeVisible();
      const first = chooser.locator('[data-binding-id]').first();
      const name = await first.locator('.canvas-binding-endpoint-name').first().textContent();
      expect(name).toBeTruthy();
      await first.focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await snapshot())?.selected).toContain(name);
      await expect(page.locator('.canvas-stage')).toBeFocused();
      const revealed = (await snapshot())!;
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('PageDown');
      await expect.poll(async () => (await snapshot())?.left[0]).toBe(`Inbound ${String(initial.left.length).padStart(2, '0')}`);
      expect((await snapshot())?.right).toEqual(revealed.right);
      expect((await snapshot())?.selected).toContain(name);
      expect((await snapshot())?.camera).toEqual(zoomed.camera);
      await page.keyboard.press('PageUp');
      await expect.poll(async () => (await snapshot())?.left).toEqual(initial.left);
      const previous = page.getByRole('button', { name: /Previous right port page/ });
      await previous.focus();
      await expect(previous).toBeFocused();
      await previous.press('Enter');
      await expect.poll(async () => (await snapshot())?.right).not.toEqual(revealed.right);
      expect((await snapshot())?.camera).toEqual(zoomed.camera);
      expect((await snapshot())?.card).toEqual(initial.card);
      return;
    }
    await page.mouse.move(initial.onRight.x, initial.onRight.y);
    await page.mouse.wheel(0, -9000); // No zoom on the first row.
    expect((await snapshot())?.camera).toEqual(initial.camera);
    const wheelRowWidth = mode === 'C' ? initial.right.length : 1;
    if (mode === 'D') await Promise.all(Array.from({ length: 4 }, () => page.mouse.wheel(0, 6)));
    else await page.mouse.wheel(0, 24 * wheelRowWidth);
    await expect.poll(async () => (await snapshot())?.right[0]).toBe(`Outbound ${String(wheelRowWidth).padStart(2, '0')}`);
    const moved = (await snapshot())!;
    expect(moved.left).toEqual(initial.left);
    expect(moved.rightNative).toEqual(initial.rightNative);
    expect(moved.top).toBe(String(wheelRowWidth));
    expect(moved.camera).toEqual(initial.camera);
    await page.screenshot({ path: testInfo.outputPath('dense-port-windows.png') });

    await page.touchscreen.tap(moved.pageBack!.x, moved.pageBack!.y);
    await expect.poll(async () => (await snapshot())?.right[0]).toBe('Outbound 00');
    await page.mouse.move(initial.onLeft.x, initial.onLeft.y);
    const leftRows = mode === 'C' ? initial.left.length : 2;
    await page.mouse.wheel(0, 24 * leftRows);
    await expect.poll(async () => (await snapshot())?.left[0]).toBe(`Inbound ${String(leftRows).padStart(2, '0')}`);
    expect((await snapshot())?.right).toEqual(initial.right);
    const point = (await snapshot())!.openBelow!;
    await page.mouse.click(point.x, point.y);
    const chooser = page.getByRole('dialog', { name: /^Connection details/ });
    await expect(chooser).toBeVisible();
    const first = chooser.locator('[data-binding-id]').first();
    const name = (await first.locator('.canvas-binding-endpoint-name').first().textContent())?.trim();
    expect(name).toMatch(/^Outbound \d+$/);
    await first.click();
    await expect.poll(async () => (await snapshot())?.selected).toContain(name);
    await expect(page.locator('.canvas-stage')).toBeFocused();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+PageUp');
    await expect.poll(async () => (await snapshot())?.right).toEqual(initial.right);

    await page.mouse.move(initial.onRight.x, initial.onRight.y);
    await page.mouse.wheel(0, 9000);
    await expect.poll(async () => (await snapshot())?.bottom).toBeUndefined();
    await page.mouse.wheel(0, 9000); // No zoom on the last row.
    expect((await snapshot())?.camera).toEqual(initial.camera);
    expect((await snapshot())?.card).toEqual(initial.card);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 24);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await snapshot())?.camera).not.toEqual(initial.camera);
    const afterPinch = (await snapshot())!;
    await page.mouse.move(afterPinch.onHeader.x, afterPinch.onHeader.y);
    await page.mouse.wheel(0, -24);
    await expect.poll(async () => (await snapshot())?.camera).not.toEqual(afterPinch.camera);
  } finally { await context.close(); }
});
