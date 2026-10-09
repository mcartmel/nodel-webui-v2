// @vitest-environment node

import { access, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { createBuildProjectFixture, createBuildProjectFixtures } from './build-project-fixture';

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Owned descendant ${pid} is still alive`);
}

async function stopProcess(pid: number): Promise<void> {
  try { process.kill(pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  await waitForProcessExit(pid);
}

describe('private build project fixture', () => {
  it('creates independent projects and copies project and dependency realpaths privately', async () => {
    const [first, second] = await createBuildProjectFixtures(2);
    const firstFixture = first!;
    const secondFixture = second!;
    try {
      expect(firstFixture.root).not.toBe(secondFixture.root);
      for (const fixture of [firstFixture, secondFixture]) {
        expect(await realpath(join(fixture.root, 'vite.config.ts'))).toBe(join(fixture.root, 'vite.config.ts'));
        expect(await realpath(join(fixture.root, 'scripts/pro-local-build.mjs'))).toBe(join(fixture.root, 'scripts/pro-local-build.mjs'));
        expect(await realpath(join(fixture.root, 'node_modules/vite/package.json'))).toBe(join(fixture.root, 'node_modules/vite/package.json'));
      }
      await writeFile(join(firstFixture.root, 'dist-sentinel'), 'private');
      await expect(access(join(secondFixture.root, 'dist-sentinel'))).rejects.toThrow();
      await Promise.all([firstFixture.dispose(), secondFixture.dispose()]);
      await expect(lstat(firstFixture.root)).rejects.toThrow();
      await expect(lstat(secondFixture.root)).rejects.toThrow();
    } finally {
      await Promise.allSettled([firstFixture.dispose(), secondFixture.dispose()]);
    }
  });

  it('retains redacted child failure diagnostics and removes only its owned workspace', async () => {
    const fixture = await createBuildProjectFixture();
    const ownedRoot = fixture.root;
    const started: Promise<unknown>[] = [];
    let readyDeadline: NodeJS.Timeout | undefined;
    let watcher: FSWatcher | undefined;
    let cancelReady: (() => void) | undefined;
    try {
      let failure = '';
      const credential = 'credential-that-must-not-appear';
      await fixture.run(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(credential)}); process.exit(7)`, '--', '--token', credential])
        .catch(error => { failure = String(error); });
      const diagnosticPath = failure.match(/diagnostics: ([^\n]+)/)?.[1];
      expect(diagnosticPath).toBeTruthy();
      const diagnostic = await readFile(diagnosticPath!, 'utf8');
      expect(diagnostic).toContain('"[redacted]"');
      expect(diagnostic).not.toContain(credential);
      expect(JSON.parse(diagnostic)).toMatchObject({ code: 7, stderr: '[redacted]' });
      expect(failure).not.toContain(credential);
      expect(failure).not.toContain('bad option');
      const ambientVariables = {
        FONT_AWESOME_PACKAGE_TOKEN: 'ambient-sensitive-value',
        NPM_CONFIG_USERCONFIG: '/tmp/private-npmrc',
        VITE_PRIVATE: 'ambient-vite-secret',
        NODEL_FONTAWESOME_PRO_DIR: '/tmp/ambient-pro-profile'
      };
      const previousVariables = Object.fromEntries(Object.keys(ambientVariables).map(key => [key, process.env[key]]));
      Object.assign(process.env, ambientVariables);
      try {
        const environmentResult = await fixture.run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify([process.env.FONT_AWESOME_PACKAGE_TOKEN, process.env.NPM_CONFIG_USERCONFIG, process.env.VITE_PRIVATE, process.env.NODEL_FONTAWESOME_PRO_DIR]))']);
        expect(environmentResult.stdout).toBe('[null,null,null,null]');
      } finally {
        for (const [key, value] of Object.entries(previousVariables)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      let timeoutFailure = '';
      await fixture.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 1000 })
        .catch(error => { timeoutFailure = String(error); });
      expect(timeoutFailure).toMatch(/diagnostics:/);

      const marker = join(fixture.root, 'grandchild.pid');
      const grandchildReady = new Promise<string>((resolveReady, rejectReady) => {
        cancelReady = () => rejectReady(new Error('Grandchild readiness cancelled'));
        watcher = watch(fixture.root, (_event, filename) => {
          if (filename?.toString() !== 'grandchild.pid') return;
          clearTimeout(readyDeadline);
          watcher?.close();
          void readFile(marker, 'utf8').then(resolveReady, rejectReady);
        });
        watcher.once('error', rejectReady);
        readyDeadline = setTimeout(() => { watcher?.close(); rejectReady(new Error('Grandchild did not start')); }, 5_000);
      });
      started.push(grandchildReady);
      void grandchildReady.catch(() => {});
      const grandchildScript = `const {spawn}=require('node:child_process');const {writeFileSync,renameSync}=require('node:fs');const marker=${JSON.stringify(marker)};const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>{writeFileSync(marker+'.tmp',String(child.pid));renameSync(marker+'.tmp',marker);child.disconnect()});setInterval(()=>{},1000)`;
      const activeSibling = fixture.run(process.execPath, ['-e', grandchildScript]);
      started.push(activeSibling);
      void activeSibling.catch(() => {});
      const grandchildPid = Number(await grandchildReady);
      const failingSibling = fixture.run(process.execPath, ['-e', 'setTimeout(() => process.exit(9), 50)']);
      started.push(failingSibling);
      void failingSibling.catch(() => {});
      await expect(Promise.all([activeSibling, failingSibling])).rejects.toThrow(/Build fixture command failed/);
      await fixture.dispose();
      await expect(activeSibling).rejects.toThrow(/Build fixture command failed/);
      await waitForProcessExit(grandchildPid);
      await expect(lstat(ownedRoot)).rejects.toThrow();
    } finally {
      clearTimeout(readyDeadline);
      watcher?.close();
      cancelReady?.();
      try { await fixture.dispose(); }
      finally { await Promise.allSettled(started); }
    }
  }, 60_000);

  it('redacts complete output before truncating failure summaries at credential boundaries', async () => {
    const fixture = await createBuildProjectFixture();
    const credential = 'boundary-credential-that-must-not-appear';
    try {
      let failure = '';
      const script = `process.stdout.write('script-executed\\n' + ${JSON.stringify(credential)} + 's'.repeat(1980)); process.stderr.write('script-executed\\n' + ${JSON.stringify(credential)} + 'e'.repeat(3980)); process.exit(7)`;
      await fixture.run(process.execPath, ['-e', script, '--', '--token', credential])
        .catch(error => { failure = String(error); });
      const diagnosticPath = failure.match(/diagnostics: ([^\n]+)/)?.[1];
      expect(diagnosticPath).toBeTruthy();
      const diagnostic = JSON.parse(await readFile(diagnosticPath!, 'utf8')) as { code: number; stdout: string; stderr: string };
      expect(diagnostic.code).toBe(7);
      expect(diagnostic.stdout).toContain('script-executed\n[redacted]');
      expect(diagnostic.stderr).toContain('script-executed\n[redacted]');
      expect(JSON.stringify(diagnostic)).not.toContain(credential);
      expect(failure).not.toContain(credential);
      expect(failure).not.toContain(credential.slice(-20));
      expect(failure).not.toContain('bad option');
    } finally { await fixture.dispose(); }
  }, 60_000);

  it.each([
    ['stdout', 16, '0123456789abcdefFEDCBA9876543210'],
    ['stderr', 16, '0123456789abcdefFEDCBA9876543210'],
    ['stdout', 15, 'ABCDEFGHIJKLMNO€PQRSTUVWXYZ01234']
  ] as const)('does not leak a known credential cut by the raw %s capture limit (%i complete prefix characters)', async (stream, prefixLength, credential) => {
    const fixture = await createBuildProjectFixture();
    const captureLimit = 16 * 1024 * 1024;
    const prefix = credential.slice(0, prefixLength);
    try {
      expect(credential).toHaveLength(32);
      let failure = '';
      const script = `process.${stream}.write('x'.repeat(${captureLimit - 16}) + ${JSON.stringify(credential)}, () => process.exit(7))`;
      await fixture.run(process.execPath, ['-e', script, '--', '--token', credential])
        .catch(error => { failure = String(error); });
      expect(failure).toContain(`Child output exceeded ${captureLimit} bytes`);
      const diagnosticPath = failure.match(/diagnostics: ([^\n]+)/)?.[1];
      expect(diagnosticPath).toBeTruthy();
      const diagnosticText = await readFile(diagnosticPath!, 'utf8');
      const diagnostic = JSON.parse(diagnosticText) as { stdout: string; stderr: string };
      // Boolean assertions avoid printing the entire 16 MiB diagnostic on failure.
      expect(diagnosticText.includes(prefix)).toBe(false);
      expect(diagnosticText.includes(credential)).toBe(false);
      expect(failure.includes(prefix)).toBe(false);
      expect(failure.includes(credential)).toBe(false);
      expect(diagnostic[stream].endsWith('[redacted]')).toBe(true);
      expect(diagnostic[stream].includes('\uFFFD')).toBe(false);
      expect(Buffer.byteLength(diagnostic[stream])).toBeLessThanOrEqual(captureLimit);
      expect(failure.length).toBeLessThan(7_000);
    } finally { await fixture.dispose(); }
  }, 60_000);

  it('does not create a new credential fragment while suppressing an overlapping capture-boundary suffix', async () => {
    const fixture = await createBuildProjectFixture();
    const captureLimit = 16 * 1024 * 1024;
    const credential = '0123456789abcdefFEDCBA9876543210';
    const overlapping = `overlap-${credential.slice(0, 8)}`;
    try {
      let failure = '';
      const script = `const secret=process.argv[2];const overlapping=process.argv[4];process.stderr.write('x'.repeat(${captureLimit - 16} - (overlapping.length - 8)) + overlapping.slice(0,-8) + secret, () => process.exit(7))`;
      await fixture.run(process.execPath, ['-e', script, '--', '--token', credential, '--password', overlapping])
        .catch(error => { failure = String(error); });
      expect(failure).toContain(`Child output exceeded ${captureLimit} bytes`);
      const diagnosticPath = failure.match(/diagnostics: ([^\n]+)/)?.[1];
      expect(diagnosticPath).toBeTruthy();
      const diagnosticText = await readFile(diagnosticPath!, 'utf8');
      const diagnostic = JSON.parse(diagnosticText) as { stderr: string };
      for (const fragment of [credential.slice(0, 16), 'overlap-']) {
        expect(diagnosticText.includes(fragment)).toBe(false);
        expect(failure.includes(fragment)).toBe(false);
      }
      expect(diagnostic.stderr.endsWith('[redacted]')).toBe(true);
      expect(Buffer.byteLength(diagnostic.stderr)).toBeLessThanOrEqual(captureLimit);
    } finally { await fixture.dispose(); }
  }, 60_000);

  it.each([7, 0])('cleans detached-stdio descendants after the orchestrator exits with code %i', async code => {
    const fixture = await createBuildProjectFixture();
    const marker = join(fixture.root, 'orphan.pid');
    let descendantPid: number | undefined;
    const started: Promise<unknown>[] = [];
    try {
      // IPC readiness proves the TERM handler is installed before the orchestrator exits.
      const descendant = "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)";
      const script = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>{writeFileSync(${JSON.stringify(marker)},String(child.pid));child.disconnect();child.unref();process.exit(${code})});`;
      const run = fixture.run(process.execPath, ['-e', script]);
      started.push(run);
      const result = await Promise.allSettled([run]);
      descendantPid = Number(await readFile(marker, 'utf8'));
      if (code === 0) expect(result[0]?.status).toBe('fulfilled');
      else expect(result[0]).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
      // The command must not relinquish ownership when just the leader closes.
      expect(() => process.kill(descendantPid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
      await expect(lstat(fixture.root)).resolves.toBeTruthy();
      await fixture.dispose();
      await expect(lstat(fixture.root)).rejects.toThrow();
    } finally {
      // Safety net for the intentionally failing pre-fix regression; never leave an orphan.
      descendantPid ??= Number(await readFile(marker, 'utf8').catch(() => '')) || undefined;
      try {
        if (descendantPid !== undefined) await stopProcess(descendantPid);
      } finally {
        try { await fixture.dispose(); }
        finally { await Promise.allSettled(started); }
      }
    }
  }, 60_000);

  it('disposes successfully acquired fixtures when another acquisition fails', async () => {
    let acquiredRoot = '';
    let attempts = 0;
    const factory = async () => {
      attempts += 1;
      if (attempts === 1) {
        const fixture = await createBuildProjectFixture();
        acquiredRoot = fixture.root;
        return fixture;
      }
      throw new Error('injected fixture acquisition failure');
    };
    await expect(createBuildProjectFixtures(2, factory)).rejects.toThrow(/injected fixture acquisition failure/);
    expect(acquiredRoot).not.toBe('');
    await expect(lstat(acquiredRoot)).rejects.toThrow();
  }, 60_000);
});
