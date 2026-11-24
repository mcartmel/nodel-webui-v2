// Regenerate offline (JDK 21 and the versioned JARs in the local Gradle cache):
// node scripts/generate-java-discovery-contract.mjs /path/to/nodel --write
// Use --check to replay and compare without overwriting the exact stored capture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, globSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const commit = '19756071383d696682688ab436c77c0a1f80c783';
const archiveSha256 = 'f869217a18515266fdab441fb1bf8591b1baa12ef935d341878ac5ecb59b4a3d';
const framework = 'nodel-framework/src/main';
const host = 'nodel-jyhost/src/main';
const scripts = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = new URL('../test/fixtures/java-discovery-contract.json', import.meta.url);
const generator = basename(fileURLToPath(import.meta.url));
const harness = 'JavaDiscoveryContract.java';
const advertisements = [
  { name: 'Contract HTTP Control', addresses: ['http://192.0.2.10:8085/nodes/%NODE%'], timeStamp: 1000 },
  { name: 'Contract Isolated TCP', addresses: ['tcp://192.0.2.11:8086'], timeStamp: 1000 }
];
const requests = {
  allNodes: { method: 'GET', path: '/REST/allNodes', body: null },
  nodeURLs: { method: 'POST', path: '/REST/nodeURLs', contentType: 'application/json', body: '{"filter":""}' }
};

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function cachedJar(coordinate, checksum) {
  const [group, artifact, version] = coordinate.split(':');
  const cache = join(process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'), 'caches/modules-2/files-2.1');
  const matches = globSync(`${group}/${artifact}/${version}/*/${artifact}-${version}.jar`, { cwd: cache });
  assert.equal(matches.length, 1, `Expected one local Gradle JAR for ${coordinate}`);
  const jar = join(cache, matches[0]);
  assert.equal(sha256(readFileSync(jar)), checksum, `Dependency checksum mismatch: ${coordinate}`);
  return jar;
}

function httpRequest({ method, path, contentType, body }) {
  const lines = [`${method} ${path} HTTP/1.1`, 'Host: contract.invalid'];
  if (body !== null) lines.push(`Content-Type: ${contentType}`, `Content-Length: ${Buffer.byteLength(body)}`);
  return `${lines.join('\r\n')}\r\n\r\n${body ?? ''}`;
}

function capturedResponse(wire) {
  const separator = wire.indexOf('\r\n\r\n');
  assert.notEqual(separator, -1, 'No HTTP headers in fixture capture');
  const [statusLine, ...lines] = wire.subarray(0, separator).toString('ascii').split('\r\n');
  const headers = Object.fromEntries(lines.map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
  }));
  const body = wire.subarray(separator + 4);
  assert.match(statusLine, /^HTTP\/1\.1 200\b/);
  assert.equal(headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(headers['content-length'], String(body.length));
  assert.equal(headers['access-control-allow-origin'], '*');
  // Keep emitted UTF-8 bytes verbatim as text; don't parse/re-serialize the JSON or capture wall-clock Date.
  return {
    statusLine,
    contentType: headers['content-type'],
    cors: headers['access-control-allow-origin'],
    body: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
  };
}

function comparableCapture(capture) {
  const { allNodes } = capture.responses;
  // Only Java Object.toString() identity suffixes may differ; keep the exact captured body on disk.
  allNodes.body = allNodes.body.replace(/"org\.nodel\.discovery\.AdvertisementInfo@[0-9a-f]{1,8}"/g,
    '"org.nodel.discovery.AdvertisementInfo@<identity>"');
  return capture;
}

const [source, mode, ...extra] = process.argv.slice(2);
assert.ok(source && !extra.length && [undefined, '--write', '--check'].includes(mode),
  `Usage: node scripts/${generator} /path/to/nodel [--write|--check]`);
const dependencies = {
  'joda-time:joda-time:2.14.0': '1e2da6f9eb65f20a25d9a3186831ed2b3fb14f7a48e1ef8206135ee58cb143d3',
  'org.slf4j:slf4j-api:1.7.10': '3863e27005740d4d1289bf87b113efea115e9a22408a7d623be8004991232bfe',
  'com.jcraft:jsch:0.1.55': 'd492b15a6d2ea3f1cc39c422c953c40c12289073dbe8360d98c0f6f9ec74fc44',
  'org.python:jython-standalone:2.5.4-rc1': '2c3ff5579dccd000185e3891567ef2cab2f367986d3dc2f9dcf2fc52739be77d'
};
const jars = Object.entries(dependencies).map(([coordinate, hash]) => cachedJar(coordinate, hash));
const work = mkdtempSync(join(tmpdir(), 'java-discovery-contract.'));
const env = { ...process.env };
// Do not let a caller inject a Java agent, classpath or flags into the isolated JVM.
for (const key of ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', 'JDK_JAVAC_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH']) delete env[key];
function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: work, env, stdio: ['pipe', 'pipe', 'inherit'], timeout: 60_000, ...options });
}

try {
  assert.match(run('java', ['--version'], { encoding: 'utf8' }), /^(?:openjdk|java) 21\b/, 'Put JDK 21 on PATH');
  assert.match(run('javac', ['--version'], { encoding: 'utf8' }), /^javac 21\b/, 'Put JDK 21 on PATH');
  const archive = join(work, 'pinned.tar');
  const classes = join(work, 'classes');
  run('git', ['-C', resolve(source), '-c', 'tar.umask=0002', '-c', 'core.attributesFile=/dev/null',
    'archive', '--format=tar', `--output=${archive}`, commit]);
  const archiveFd = openSync(archive, 'r');
  try {
    assert.equal(run('git', ['get-tar-commit-id'], { stdio: [archiveFd, 'pipe', 'inherit'], encoding: 'utf8' }).trim(), commit);
  } finally {
    closeSync(archiveFd);
  }
  assert.equal(sha256(readFileSync(archive)), archiveSha256, 'Unexpected pinned Java archive contents');
  run('tar', ['-xf', archive]);
  mkdirSync(classes);
  const javaModules = [framework, host];
  run('javac', ['-proc:none', '--release', '11', '-encoding', 'UTF-8', '-d', classes,
    '-sourcepath', javaModules.map((dir) => `${dir}/java`).join(delimiter),
    '-classpath', jars.join(delimiter), join(scripts, harness)]);
  writeFileSync(join(work, 'advertisements.json'), JSON.stringify(advertisements));
  for (const [id, request] of Object.entries(requests)) writeFileSync(join(work, `${id}.request`), httpRequest(request));
  run('java', ['-Djava.security.manager=allow', `-Djava.io.tmpdir=${work}`, '-cp',
    [classes, ...javaModules.map((dir) => `${dir}/resources`), ...jars].join(delimiter),
    'JavaDiscoveryContract', work, ...Object.keys(requests)]);
  const responses = Object.fromEntries(Object.keys(requests).map((id) => [id, capturedResponse(readFileSync(join(work, `${id}.response`)))]));
  const capture = {
    provenance: {
      repository: 'museumsvictoria/nodel',
      commit,
      archiveSha256,
      build: { jdk: 21, release: 11, dependencySha256: dependencies },
      regenerate: `node scripts/${generator} /path/to/nodel --write`,
      verify: `node scripts/${generator} /path/to/nodel --check`,
      generatorSha256: sha256(readFileSync(join(scripts, generator))),
      harness: `scripts/${harness}`,
      harnessSha256: sha256(readFileSync(join(scripts, harness))),
      path: 'In-memory HTTP bytes → pinned HTTPSession → NanoHTTPD → NodelHostHTTPD.serve → RESTModel/REST.resolveRESTcall → Serialisation.serialise → HTTP Response.send',
      isolation: 'No Nodel launch or host constructors; no network sockets; synthetic AutoDNS via the original provider hook. Each request called the complete listing once.',
      replayNote: 'allNodes object identity suffixes can vary by JVM run; --check compares everything except those suffixes. The body below is unmodified.'
    },
    inputs: { advertisements, localNodes: [], bindingReferences: [], requests },
    responses
  };
  if (mode === '--check') {
    assert.deepEqual(comparableCapture(capture), comparableCapture(JSON.parse(readFileSync(fixturePath, 'utf8'))));
    process.stdout.write('Pinned Java discovery capture matches the fixture.\n');
  } else {
    const json = `${JSON.stringify(capture, null, 2)}\n`;
    if (mode === '--write') writeFileSync(fixturePath, json);
    else process.stdout.write(json);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
