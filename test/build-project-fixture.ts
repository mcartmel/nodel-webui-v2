import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, cp, lstat, mkdtemp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childTimeoutMs = 20_000;
const childKillGraceMs = 300;
const childGroupExitTimeoutMs = 5_000;
const childOutputLimit = 16 * 1024 * 1024;
const projectInputs = [
  'src', 'scripts', 'public', 'components.html', 'nodes.html', 'nodel.html', 'toolkit.html',
  'package.json', 'package-lock.json', 'vite.config.ts', 'postcss.config.cjs', 'tailwind.config.ts',
  'tsconfig.json', 'deployment-manifest.json'
];

async function copyPrivateTree(source: string, destination: string, boundary: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    const target = await realpath(source);
    const relativeTarget = relative(boundary, target);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) throw new Error(`Build fixture dependency link escapes node_modules: ${source}`);
    await copyPrivateTree(target, destination, boundary);
    return;
  }
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) await copyPrivateTree(join(source, entry), join(destination, entry), boundary);
  } else if (info.isFile()) {
    try { await copyFile(source, destination, constants.COPYFILE_FICLONE); }
    catch (error) {
      if (!['ENOTSUP', 'EINVAL', 'ENOSYS', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await copyFile(source, destination);
    }
  }
}

export interface BuildProjectFixture {
  root: string;
  run(command: string, args: string[], options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string }>;
  dispose(): Promise<void>;
}

function processGroupSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function processGroupExists(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function sanitizedEnvironment(environment: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const blockedAmbient = /^(?:npm_config_.*|npm_token|npm_auth_token|node_auth_token|font.?awesome.*(?:token|auth|credential)|nodel_fontawesome_pro_dir|vite_.*)$/i;
  const blockedOverride = /^(?:npm_config_.*|npm_token|npm_auth_token|node_auth_token|font.?awesome.*(?:token|auth|credential)|vite_.*)$/i;
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) if (!blockedAmbient.test(key) && value !== undefined) result[key] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (!blockedOverride.test(key) && value !== undefined) result[key] = value;
  }
  return result;
}

function redactText(text: string, secrets: string[]): string {
  let redacted = text
    .replace(/((?:_authToken|token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(\b--?(?:token|password|secret|api-key)\s+)\S+/gi, '$1[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[redacted]@');
  for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}

function terminalSecretPrefixLength(output: Buffer, secret: Buffer): number {
  // KMP keeps suffix detection linear even for long, repetitive credentials.
  const prefixLengths = new Uint32Array(secret.length);
  for (let index = 1, matched = 0; index < secret.length; index += 1) {
    while (matched > 0 && secret[index] !== secret[matched]) matched = prefixLengths[matched - 1]!;
    if (secret[index] === secret[matched]) matched += 1;
    prefixLengths[index] = matched;
  }
  let matched = 0;
  for (const byte of output.subarray(Math.max(0, output.length - secret.length))) {
    while (matched > 0 && byte !== secret[matched]) matched = prefixLengths[matched - 1]!;
    if (byte === secret[matched]) matched += 1;
  }
  return matched;
}

function redactCapturedOutput(output: Buffer, secrets: string[]): string {
  if (output.length < childOutputLimit) return redactText(output.toString('utf8'), secrets);
  // A hard byte cutoff can retain only a credential prefix, including half a
  // UTF-8 character. Suppress that suffix before decoding or ordinary redaction.
  const encodedSecrets = secrets.filter(Boolean).map(secret => Buffer.from(secret, 'utf8'));
  let cutoff = output.length;
  for (const secret of encodedSecrets) cutoff = Math.min(cutoff, output.length - terminalSecretPrefixLength(output, secret));
  if (cutoff === output.length) return redactText(output.toString('utf8'), secrets);
  // Extend suppression left if it would otherwise split an overlapping complete
  // credential. The search windows are bounded by credential size, not output size.
  let changed = true;
  while (changed) {
    changed = false;
    for (const secret of encodedSecrets) {
      const start = Math.max(0, cutoff - secret.length + 1);
      const end = Math.min(output.length, cutoff + secret.length - 1);
      const offset = output.subarray(start, end).indexOf(secret);
      if (offset >= 0 && start + offset < cutoff) {
        cutoff = start + offset;
        changed = true;
      }
    }
  }
  return `${redactText(output.subarray(0, cutoff).toString('utf8'), secrets)}[redacted]`;
}

function redactArguments(args: string[], secrets: string[]): string[] {
  return args.map((argument, index) => {
    const previous = args[index - 1] ?? '';
    if (/^--?(?:token|password|secret|api-key)$/i.test(previous)) return '[redacted]';
    return redactText(argument, secrets);
  });
}

export async function createBuildProjectFixture(): Promise<BuildProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), 'nodel-build-project-'));
  const activeChildren = new Map<ChildProcess, { closed: Promise<void>; terminate: () => Promise<void> }>();
  let disposing = false;
  try {
    for (const input of projectInputs) await cp(join(projectRoot, input), join(root, input), { recursive: true, force: true, verbatimSymlinks: false });
    const sourceDependencies = join(projectRoot, 'node_modules');
    const copiedDependencies = join(root, 'node_modules');
    await mkdir(copiedDependencies, { recursive: true });
    for (const entry of await readdir(sourceDependencies)) {
      if (entry === '.cache' || entry === '.vite') continue;
      await copyPrivateTree(join(sourceDependencies, entry), join(copiedDependencies, entry), sourceDependencies);
    }
    const dependenciesRealpath = await realpath(copiedDependencies);
    if (!dependenciesRealpath.startsWith(`${root}/`)) throw new Error('Build fixture dependencies are not private');
    return {
      root,
      async run(command, args, options = {}) {
        if (disposing) throw new Error('Cannot start a build fixture process after disposal has started');
        const timeoutMs = options.timeoutMs ?? childTimeoutMs;
        const secretEnvironment = { ...process.env, ...options.env };
        const secrets = Object.entries(secretEnvironment)
          .filter(([key, value]) => /token|password|secret|auth|credential|api[_-]?key/i.test(key) && value)
          .map(([, value]) => value!);
        for (let index = 0; index < args.length - 1; index += 1) {
          if (/^--?(?:token|password|secret|api-key)$/i.test(args[index]!)) secrets.push(args[index + 1]!);
        }
        const safeArgs = redactArguments(args, secrets);
        const childEnv = sanitizedEnvironment(process.env, options.env);
        const child = spawn(command, args, { cwd: root, env: childEnv, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let overflow = false;
        let timedOut = false;
        let spawnError: Error | undefined;
        let closed = false;
        let timeoutTimer: NodeJS.Timeout | undefined;
        let cleanupComplete = false;
        let resolveClosed!: () => void;
        const closedPromise = new Promise<void>(resolveClose => { resolveClosed = resolveClose; });
        const closeResult = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveClose => {
          child.once('error', error => { spawnError = error; });
          child.once('close', (code, signal) => {
            closed = true;
            if (timeoutTimer) clearTimeout(timeoutTimer);
            resolveClosed();
            resolveClose({ code, signal });
          });
        });
        const capture = (chunk: Buffer, chunks: Buffer[], currentBytes: number): number => {
          const remaining = childOutputLimit - currentBytes;
          if (remaining <= 0) { overflow = true; return currentBytes; }
          if (chunk.length > remaining) { chunks.push(chunk.subarray(0, remaining)); overflow = true; }
          else chunks.push(chunk);
          return currentBytes + Math.min(chunk.length, remaining);
        };
        let termination: Promise<void> | undefined;
        const terminate = () => {
          if (termination) return termination;
          termination = (async () => {
            if (processGroupExists(child)) {
              processGroupSignal(child, 'SIGTERM');
              await new Promise(resolveGrace => setTimeout(resolveGrace, childKillGraceMs));
              processGroupSignal(child, 'SIGKILL');
            }
            await closedPromise;
            // Leader close does not establish descendant exit: ignored stdio lets an
            // orphan survive independently. Retain ownership until the whole group is gone.
            const deadline = Date.now() + childGroupExitTimeoutMs;
            while (processGroupExists(child)) {
              if (Date.now() >= deadline) throw new Error('Build fixture process group did not exit after SIGKILL; workspace retained');
              await new Promise(resolvePoll => setTimeout(resolvePoll, 10));
            }
            cleanupComplete = true;
          })();
          return termination;
        };
        // Start cleanup on exit rather than close, which can wait on inherited pipes.
        // Event callbacks observe rejections; run/dispose still await and surface them.
        child.once('exit', () => { void terminate().catch(() => {}); });
        child.stdout?.on('data', (chunk: Buffer) => { stdoutBytes = capture(chunk, stdoutChunks, stdoutBytes); if (overflow && !closed) void terminate().catch(() => {}); });
        child.stderr?.on('data', (chunk: Buffer) => { stderrBytes = capture(chunk, stderrChunks, stderrBytes); if (overflow && !closed) void terminate().catch(() => {}); });
        activeChildren.set(child, { closed: closedPromise, terminate });
        if (timeoutMs > 0) timeoutTimer = setTimeout(() => { timedOut = true; void terminate().catch(() => {}); }, timeoutMs);
        try {
          const result = await closeResult;
          await terminate();
          const stdout = Buffer.concat(stdoutChunks);
          const stderr = Buffer.concat(stderrChunks);
          if (result.code === 0 && !result.signal && !timedOut && !overflow && !spawnError) return { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
          const reason = spawnError?.message ?? (timedOut ? `Child timed out after ${timeoutMs}ms` : overflow ? `Child output exceeded ${childOutputLimit} bytes` : `Child exited with code ${result.code ?? 'null'} and signal ${result.signal ?? 'none'}`);
          const failureRoot = join(projectRoot, 'build', 'test-failures');
          await mkdir(failureRoot, { recursive: true });
          const diagnostic = join(failureRoot, `build-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
          const safeStdout = redactCapturedOutput(stdout, secrets);
          const safeStderr = redactCapturedOutput(stderr, secrets);
          const safeReason = redactText(reason, secrets);
          await writeFile(diagnostic, `${JSON.stringify({ command: redactText(command, secrets), args: safeArgs, cwd: root, code: result.code, signal: result.signal, stdout: safeStdout, stderr: safeStderr, error: safeReason }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
          const outputSummary = [safeStdout.slice(-2_000), safeStderr.slice(-4_000)].filter(Boolean).join('\n');
          throw new Error(`Build fixture command failed; diagnostics: ${diagnostic}\n${safeReason}\n${outputSummary}`);
        } finally {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (cleanupComplete) activeChildren.delete(child);
        }
      },
      async dispose() {
        disposing = true;
        const owned = [...activeChildren.values()];
        const results = await Promise.allSettled(owned.map(child => child.terminate()));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
        await Promise.all(owned.map(child => child.closed));
        await rm(root, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function createBuildProjectFixtures(count: number, createFixture = createBuildProjectFixture): Promise<BuildProjectFixture[]> {
  const results = await Promise.allSettled(Array.from({ length: count }, () => createFixture()));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    await Promise.allSettled(results.flatMap(result => result.status === 'fulfilled' ? [result.value.dispose()] : []));
    throw failed.reason;
  }
  return results.map(result => (result as PromiseFulfilledResult<BuildProjectFixture>).value);
}
