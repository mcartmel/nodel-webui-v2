import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(resolve(root, 'browser-test-environment.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const expectedNode = readFileSync(resolve(root, '.nvmrc'), 'utf8').trim();
const expectedNpm = packageJson.packageManager.replace(/^npm@/, '');
const playwrightVersion = packageJson.devDependencies['@playwright/test'].replace(/^[~^]/, '');
const deploymentVariables = ['DEPLOYMENT_SMOKE_PREVIEW_URL', 'DEPLOYMENT_SMOKE_MANAGED_URL', 'DEPLOYMENT_SMOKE_ASSETS', 'DEPLOYMENT_SMOKE_PACKAGE_VERSION'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

function combinedOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return `${result.stdout}${result.stderr}`.trim();
}

function assertPolicy() {
  if (policy.schemaVersion !== 1) throw new Error('Unsupported browser test environment schema');
  if (playwrightVersion !== policy.playwrightVersion) {
    throw new Error(`Playwright ${playwrightVersion} does not match browser image policy ${policy.playwrightVersion}`);
  }
}

function readExecutableFormat(path) {
  const bytes = Buffer.alloc(20);
  const descriptor = openSync(path, 'r');
  try {
    if (readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) return 'unknown';
  } finally {
    closeSync(descriptor);
  }
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'unknown';
  if (bytes[4] !== 2 || bytes.readUInt16LE(18) !== 62) return 'unsupported-elf';
  return 'elf64-x86-64';
}

export function assertSupportedHost(platform, arch, executableFormat) {
  if (platform !== 'linux' || arch !== 'x64' || executableFormat !== 'elf64-x86-64') {
    throw new Error(
      `Pinned browser tests require a Linux x64 host with an x86-64 ELF Node.js ${expectedNode} executable; `
      + `received ${platform}/${arch} with ${executableFormat}. Use the Ubuntu CI job or a Linux x64 VM.`
    );
  }
}

export function buildDockerArgs({ args, environment, executablePath, gid, npmVersion, projectRoot, uid }) {
  const dockerArgs = [
    'run', '--rm', '--init', '--ipc=host',
    '--platform', policy.platform,
    '--user', `${uid}:${gid}`,
    '--volume', `${projectRoot}:/work`,
    '--volume', `${executablePath}:/opt/nodel-node:ro`,
    '--workdir', '/work',
    '--env', 'HOME=/tmp',
    '--env', `FONTCONFIG_FILE=/work/${policy.fontconfigFile}`,
    '--env', 'NODEL_PLAYWRIGHT_CONTAINER=1',
    '--env', `NODEL_PLAYWRIGHT_IMAGE=${policy.image}`,
    '--env', `NODEL_HOST_NPM_VERSION=${npmVersion}`
  ];
  if (environment.CI) dockerArgs.push('--env', `CI=${environment.CI}`);
  if (deploymentVariables.some((name) => environment[name])) dockerArgs.push('--network=host');
  for (const name of deploymentVariables) {
    if (environment[name]) dockerArgs.push('--env', `${name}=${environment[name]}`);
  }
  dockerArgs.push(policy.image, '/opt/nodel-node', 'scripts/run-browser-tests.mjs', ...args);
  return dockerArgs;
}

async function preflight() {
  assertPolicy();
  if (process.version !== `v${expectedNode}`) {
    throw new Error(`Browser tests require Node.js v${expectedNode}; received ${process.version}`);
  }
  if (process.env.NODEL_HOST_NPM_VERSION !== expectedNpm) {
    throw new Error(`Browser tests require host npm ${expectedNpm}; received ${process.env.NODEL_HOST_NPM_VERSION ?? 'unknown'}`);
  }
  if (process.env.NODEL_PLAYWRIGHT_IMAGE !== policy.image) throw new Error('Browser test image does not match policy');
  if (process.env.FONTCONFIG_FILE !== `/work/${policy.fontconfigFile}`) throw new Error('Browser Fontconfig policy is not active');

  const fontMatch = output('fc-match', [':family=system-ui']);
  if (!fontMatch.includes(policy.fontFamily)) {
    throw new Error(`system-ui must resolve to ${policy.fontFamily}; received ${fontMatch}`);
  }
  const fontconfigVersion = combinedOutput('fc-match', ['--version']);
  const freetypeVersion = output('dpkg-query', ['-W', '-f=${Version}', 'libfreetype6']);
  const { chromium, firefox, webkit } = await import('playwright');
  const versions = {};
  for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await browserType.launch();
    versions[name] = browser.version();
    await browser.close();
  }

  console.log(JSON.stringify({
    browserEnvironment: {
      image: policy.image,
      platform: policy.platform,
      node: process.version,
      npm: process.env.NODEL_HOST_NPM_VERSION,
      playwright: playwrightVersion,
      fontMatch,
      fontconfigVersion,
      freetypeVersion,
      browsers: versions
    }
  }));
}

async function main() {
  assertPolicy();
  const args = process.argv.slice(2);
  if (process.env.NODEL_PLAYWRIGHT_CONTAINER === '1') {
    await preflight();
    if (args.length === 1 && args[0] === '--preflight-only') return;
    run(process.execPath, [resolve(root, 'node_modules/playwright/cli.js'), 'test', ...args]);
    return;
  }

  assertSupportedHost(process.platform, process.arch, readExecutableFormat(process.execPath));
  const npmVersion = output('npm', ['--version']);
  if (npmVersion !== expectedNpm) throw new Error(`Browser tests require npm ${expectedNpm}; received ${npmVersion}`);
  run('docker', buildDockerArgs({
    args,
    environment: process.env,
    executablePath: process.execPath,
    gid: process.getgid(),
    npmVersion,
    projectRoot: root,
    uid: process.getuid()
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
