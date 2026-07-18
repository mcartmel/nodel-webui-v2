import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const buildRoot = join(projectRoot, 'build', 'prepare-release-test');
const validCommit = '0123456789abcdef0123456789abcdef01234567';

async function writeFixtureSource(source: string) {
  await mkdir(join(source, 'v2'), { recursive: true });
  const files = [
    'components.html',
    'index.htm',
    'nodel.html',
    'nodes.html',
    'toolkit.html',
    'v2/nodel-webui.css',
    'v2/nodel-webui.js'
  ];

  for (const file of files) {
    await mkdir(dirname(join(source, file)), { recursive: true });
    await writeFile(join(source, file), file.endsWith('.css') ? 'body {}\n' : '<!doctype html>\n', 'utf8');
  }
}

async function prepareRelease(targetName: string, commit = validCommit) {
  const source = join(buildRoot, `${targetName}-source`);
  const target = join(buildRoot, `${targetName}-target`);
  await writeFixtureSource(source);
  await execFileAsync('node', [
    './scripts/prepare-release.mjs',
    '--source', source,
    '--target', target,
    '--commit', commit
  ], { cwd: projectRoot });
  return target;
}

describe('prepare-release', () => {
  beforeEach(async () => {
    await rm(buildRoot, { recursive: true, force: true });
    await mkdir(buildRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(buildRoot, { recursive: true, force: true });
  });

  it('writes manifest API range metadata and third-party notices', async () => {
    const target = await prepareRelease('valid');
    const manifest = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
    const packageMetadata = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      name: 'nodel-webui-v2',
      version: packageMetadata.version,
      commit: validCommit,
      nodelApi: {
        min: '1.0',
        maxExclusive: '2.0',
        requiredFeatures: []
      }
    });

    await expect(readFile(join(target, 'THIRD-PARTY-NOTICES.md'), 'utf8')).resolves.toContain('Third-Party Notices');
  });

  it('rejects malformed release commits before writing metadata', async () => {
    await expect(prepareRelease('bad-commit', 'not-a-commit')).rejects.toThrow(/40-character hexadecimal/);
  });
});
