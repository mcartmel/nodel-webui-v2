import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinkAncestors, projectBuildRoot, parseStrictArgs, safeRelativePath } from './deployment-contract.mjs';
import { verifyReleaseBundle } from './release-contract.mjs';

const execFileAsync = promisify(execFile);

export function parseVerifyReleaseArchiveArgs(argv) {
  return parseStrictArgs(argv, { target: { required: true }, json: { type: 'boolean', default: false } });
}

function checkedEntry(value) {
  const directory = value.endsWith('/');
  const path = directory ? value.slice(0, -1) : value;
  if (!safeRelativePath(path)) throw new Error(`Archive contains an unsafe entry: ${JSON.stringify(value)}`);
  return { path, directory };
}

function requiredDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    parts.pop();
    while (parts.length) {
      directories.add(parts.join('/'));
      parts.pop();
    }
  }
  return [...directories].sort();
}

function zipinfoEnvironment() {
  return { ...process.env, LC_ALL: 'C', LANG: 'C' };
}

function parseZipUnixTypes(output, entryCount) {
  const blocks = output.match(/Central directory entry #\d+:\r?\n-+\r?\n[\s\S]*?(?=\r?\nCentral directory entry #\d+:|$)/g) ?? [];
  if (blocks.length !== entryCount) throw new Error('Archive ZIP metadata does not describe every entry');
  return blocks.map((block) => {
    if (!/file system or operating system of origin:\s+Unix(?:\r?\n|$)/.test(block)) {
      throw new Error('Archive entry does not provide Unix file type metadata');
    }
    const attributes = block.match(/Unix file attributes \(([0-7]+) octal\):/);
    if (!attributes) throw new Error('Archive entry is missing Unix file attributes');
    const mode = Number.parseInt(attributes[1], 8);
    const type = mode & 0o170000;
    if (type !== 0o100000 && type !== 0o040000) {
      throw new Error(`Archive contains a non-file, non-directory, or symlink entry (Unix mode ${attributes[1]})`);
    }
    return type === 0o040000 ? 'directory' : 'file';
  });
}

async function inspectedEntries(archive) {
  let names;
  let verbose;
  try {
    [names, verbose] = await Promise.all([
      execFileAsync('zipinfo', ['-1', archive], { encoding: 'utf8', env: zipinfoEnvironment() }),
      execFileAsync('zipinfo', ['-v', archive], { encoding: 'utf8', env: zipinfoEnvironment() })
    ]);
  } catch (error) {
    throw new Error(`Cannot safely inspect release archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const lines = names.stdout.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const types = parseZipUnixTypes(verbose.stdout, lines.length);
  const seen = new Set();
  return lines.map((value, index) => {
    const entry = checkedEntry(value);
    if (seen.has(entry.path)) throw new Error(`Archive contains a duplicate entry: ${entry.path}`);
    seen.add(entry.path);
    if ((entry.directory ? 'directory' : 'file') !== types[index]) {
      throw new Error(`Archive entry type does not match its path: ${JSON.stringify(value)}`);
    }
    return entry;
  });
}

async function extractedTree(root, relativeRoot = '') {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (!safeRelativePath(relativePath)) throw new Error(`Archive extraction contains an unsafe entry: ${JSON.stringify(relativePath)}`);
    const information = await lstat(path);
    if (information.isSymbolicLink()) throw new Error(`Archive extraction contains a symlink: ${relativePath}`);
    if (information.isFile()) files.push(relativePath);
    else if (information.isDirectory()) {
      directories.push(relativePath);
      const nested = await extractedTree(path, relativePath);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else throw new Error(`Archive extraction contains an unsupported entry: ${relativePath}`);
  }
  return { files: files.sort(), directories: directories.sort() };
}

export async function verifyReleaseArchive(target) {
  const archive = resolve(target);
  const information = await lstat(archive).catch(() => null);
  if (!information?.isFile() || information.isSymbolicLink()) throw new Error(`Release archive must be a regular file: ${archive}`);
  const listed = await inspectedEntries(archive);
  await assertNoSymlinkAncestors(projectBuildRoot);
  let temporary;
  try { temporary = await mkdtemp(join(projectBuildRoot, '.verify-release-archive-')); }
  catch { throw new Error(`Archive verification requires project build directory: ${projectBuildRoot}`); }
  try {
    await execFileAsync('unzip', ['-qq', archive, '-d', temporary], { encoding: 'utf8', env: zipinfoEnvironment() });
    const manifest = await verifyReleaseBundle(temporary);
    const expected = new Set([...manifest.files.map((entry) => entry.path), 'release.json']);
    const archiveFiles = listed.filter((entry) => !entry.directory).map((entry) => entry.path);
    if (archiveFiles.length !== expected.size || archiveFiles.some((path) => !expected.has(path))) throw new Error('Archive entries do not exactly match the release bundle inventory');
    const expectedDirectories = requiredDirectories([...expected]);
    const archiveDirectories = listed.filter((entry) => entry.directory).map((entry) => entry.path).sort();
    if (archiveDirectories.some((path) => !expectedDirectories.includes(path))) throw new Error('Archive contains an unexpected directory entry');
    const extracted = await extractedTree(temporary);
    if (extracted.files.join('\0') !== [...expected].sort().join('\0') || extracted.directories.join('\0') !== expectedDirectories.join('\0')) {
      throw new Error('Archive extraction does not exactly match the release bundle inventory');
    }
    return { archive, version: manifest.version, commit: manifest.commit, publishable: manifest.source.publishable };
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const options = parseVerifyReleaseArchiveArgs(process.argv.slice(2));
  const report = await verifyReleaseArchive(options.target);
  console.log(options.json ? JSON.stringify(report) : `Verified release archive ${report.version} at ${report.archive}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
