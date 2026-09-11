// @vitest-environment node

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

type Invocation = { script: 'build:preview' | 'test:browser:dist'; args: string[] };

function npmCommand() {
  const cliPath = join(dirname(process.execPath), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cliPath)) return { command: process.execPath, args: [cliPath] };
  return { command: 'npm', args: [] };
}

function runNpm(root: string, args: string[]) {
  const { command, args: prefix } = npmCommand();
  return execFileSync(command, [...prefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NPM_CONFIG_PROGRESS: 'false' }
  });
}

describe('run-browser-tests convenience forwarding contract', () => {
  it('forwards args from test:browser into test:browser:dist without invoking real browser tooling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nodel-browser-forwarding-'));
    const scripts = join(root, 'scripts');
    const recordPath = join(root, 'command-record.json');
    try {
      const packageJson = {
        name: 'browser-command-fixture',
        private: true,
        scripts: {
          'build:preview': 'node ./scripts/record-call.mjs build:preview',
          'test:browser:dist': 'node ./scripts/record-call.mjs test:browser:dist',
          'test:browser': 'npm run build:preview && npm run test:browser:dist --'
        }
      };
      const recordScript = `import { readFileSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n\nconst target = join(process.cwd(), 'command-record.json');\nconst script = process.argv[2] ?? 'unknown';\nconst args = process.argv.slice(3);\nlet calls = [];\ntry {\n  calls = JSON.parse(readFileSync(target, 'utf8'));\n} catch {}\ncalls.push({ script, args });\nwriteFileSync(target, JSON.stringify(calls));\n`;

      await mkdir(scripts, { recursive: true });
      await writeFile(join(root, 'package.json'), JSON.stringify(packageJson));
      await writeFile(join(scripts, 'record-call.mjs'), recordScript);

      runNpm(root, ['run', 'test:browser', '--', '--project=chromium-light-desktop', '--update-snapshots']);

      const entries = JSON.parse(await readFile(recordPath, 'utf8')) as Invocation[];
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ script: 'build:preview', args: [] });
      expect(entries[1]).toEqual({
        script: 'test:browser:dist',
        args: ['--project=chromium-light-desktop', '--update-snapshots']
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
