import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateComponentContractArtifact as validateFullComponentContractArtifact } from './component-contract-validator.mjs';

const execFileAsync = promisify(execFile);
const moduleRoot = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(moduleRoot, '..');
export const projectBuildRoot = resolve(projectRoot, 'build');
export const markerName = '.nodel-webui-test-deploy.json';
export const markerSchemaVersion = 2;
export const componentContractPath = 'v2/nodel-components.json';
export const componentContractSchemaVersion = 1;
const stableEntries = Object.freeze(['components.html', 'index.htm', 'nodel.html', 'nodes.html', 'toolkit.html']);
const fsApi = { lstat, readFile, readdir, realpath };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

/** Validate the stable, release-facing envelope without coupling scripts to TypeScript contract internals. */
export function validateComponentContractArtifact(content, packageVersion) {
  return validateFullComponentContractArtifact(content, packageVersion);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !/[\\\0-\x1f\x7f]/.test(value)
    && !isAbsolute(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function isInside(parent, child) {
  const result = relative(resolve(parent), resolve(child));
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result));
}

export function parseStrictArgs(argv, definitions) {
  const result = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || argument === '--') throw new Error(`Unknown positional argument: ${argument}`);
    const name = argument.slice(2);
    const definition = definitions[name];
    if (!definition) throw new Error(`Unknown argument: ${argument}`);
    if (seen.has(name)) throw new Error(`Duplicate argument: ${argument}`);
    seen.add(name);
    if (definition.type === 'boolean') {
      result[definition.key ?? name] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    result[definition.key ?? name] = value;
  }
  for (const [name, definition] of Object.entries(definitions)) {
    const key = definition.key ?? name;
    if (!(key in result) && 'default' in definition) result[key] = typeof definition.default === 'function' ? definition.default() : definition.default;
    if (definition.required && !(key in result)) throw new Error(`Missing required argument: --${name}`);
  }
  return result;
}

export async function loadDeploymentManifest(manifestPath, { fs = fsApi } = {}) {
  const path = resolve(manifestPath);
  let text;
  let manifest;
  try {
    text = await fs.readFile(path, 'utf8');
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`Cannot read deployment manifest ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!sameKeys(manifest, ['schemaVersion', 'artifact', 'v1', 'java']) || manifest.schemaVersion !== 1
    || !isRecord(manifest.artifact) || !isRecord(manifest.v1) || !isRecord(manifest.java)) {
    throw new Error('Deployment manifest must be a schemaVersion 1 object');
  }
  if (!sameKeys(manifest.artifact, ['name', 'repository', 'stableEntries', 'supportTree'])
    || manifest.artifact.name !== 'nodel-webui-v2' || manifest.artifact.repository !== 'mcartmel/nodel-webui-v2'
    || !Array.isArray(manifest.artifact.stableEntries)
    || manifest.artifact.stableEntries.join('\0') !== stableEntries.join('\0')
    || manifest.artifact.supportTree !== 'v2/**') {
    throw new Error('Deployment manifest must declare exactly the five stable release pages in canonical sorted order and v2 support tree');
  }
  if (!sameKeys(manifest.v1, ['defaultPolicy', 'protectedOwnership', 'collisions']) || manifest.v1.defaultPolicy !== 'preserve' || !isRecord(manifest.v1.protectedOwnership)
    || !sameKeys(manifest.v1.protectedOwnership, ['path', 'rule'])
    || manifest.v1.protectedOwnership.path !== 'nodel-webui-js/src/**'
    || manifest.v1.protectedOwnership.rule !== 'no-overwrite-except-declared-collisions') {
    throw new Error('Deployment manifest must preserve protected V1 ownership');
  }
  if (!Array.isArray(manifest.v1.collisions) || manifest.v1.collisions.length !== 1) throw new Error('Deployment manifest must declare its V1 collisions');
  const [collision] = manifest.v1.collisions;
  if (!sameKeys(collision, ['path', 'bundle', 'isolatedTestDeployment', 'productionJavaMerge']) || collision.path !== 'index.htm' || collision.bundle !== 'included' || collision.isolatedTestDeployment !== 'install'
    || !isRecord(collision.productionJavaMerge) || !sameKeys(collision.productionJavaMerge, ['default', 'requiresRecordedApproval']) || collision.productionJavaMerge.default !== 'preserve-v1'
    || collision.productionJavaMerge.requiresRecordedApproval !== true) throw new Error('Deployment manifest index.htm collision rule is invalid');
  if (!sameKeys(manifest.java, ['repository', 'v1Source', 'cleanlinessIgnoredPaths', 'targets'])
    || manifest.java.repository !== 'museumsvictoria/nodel' || manifest.java.v1Source !== 'nodel-webui-js/src' || !Array.isArray(manifest.java.cleanlinessIgnoredPaths)
    || manifest.java.cleanlinessIgnoredPaths.join(',') !== '.gradle/**,build/**' || !isRecord(manifest.java.targets)
    || !sameKeys(manifest.java.targets, ['dev', 'master']) || manifest.java.targets.dev !== 'prerelease' || manifest.java.targets.master !== 'stable') throw new Error('Deployment manifest Java handoff contract is invalid');
  return Object.freeze({ manifest, path, hash: sha256(text) });
}

async function checkedLstat(path, fs = fsApi) {
  return fs.lstat(path).catch(() => null);
}

/** Reject every extant link in a path, including the root being guarded. */
export async function assertNoSymlinkAncestors(path, { fs = fsApi } = {}) {
  const parts = [];
  let current = resolve(path);
  while (true) {
    parts.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of parts.reverse()) {
    const information = await checkedLstat(candidate, fs);
    if (information?.isSymbolicLink()) throw new Error(`Path must not contain symlinks: ${candidate}`);
  }
}

async function canonicalPotential(path, fs = fsApi) {
  const missing = [];
  let current = resolve(path);
  while (!await checkedLstat(current, fs)) {
    missing.unshift(current.split(sep).pop());
    const parent = dirname(current);
    if (parent === current) throw new Error(`No existing ancestor for ${path}`);
    current = parent;
  }
  return resolve(await fs.realpath(current), ...missing);
}

async function walkTree(root, relativeRoot = '', { fs = fsApi } = {}) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (!safeRelativePath(relativePath)) throw new Error(`Unsafe filesystem entry: ${path}`);
    const information = await fs.lstat(path);
    if (information.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${path}`);
    if (information.isDirectory()) {
      directories.push(relativePath);
      const nested = await walkTree(path, relativePath, { fs });
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (information.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported filesystem entry: ${path}`);
    }
  }
  return { files: files.sort(), directories: directories.sort() };
}

async function makeFileEntry(root, path, { fs = fsApi } = {}) {
  const fullPath = join(root, path);
  const information = await fs.lstat(fullPath);
  if (!information.isFile() || information.isSymbolicLink()) throw new Error(`Inventory entry must be a regular file: ${fullPath}`);
  const content = await fs.readFile(fullPath);
  const finalInformation = await fs.lstat(fullPath);
  if (!finalInformation.isFile() || finalInformation.isSymbolicLink()
    || finalInformation.dev !== information.dev || finalInformation.ino !== information.ino
    || finalInformation.size !== information.size || content.length !== information.size) {
    throw new Error(`Inventory entry changed while being captured: ${fullPath}`);
  }
  return Object.freeze({ path, bytes: information.size, sha256: sha256(content) });
}

/** Read an already-inventoried file without accepting a swapped link or bytes. */
export async function readCapturedDeploymentEntry(root, entry, { fs = fsApi } = {}) {
  if (!entry || !safeRelativePath(entry.path) || !Number.isSafeInteger(entry.bytes) || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error('Invalid captured deployment inventory entry');
  }
  const fullPath = join(root, entry.path);
  const initial = await fs.lstat(fullPath);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error(`Captured deployment entry is not a regular file: ${fullPath}`);
  const content = await fs.readFile(fullPath);
  const final = await fs.lstat(fullPath);
  if (!final.isFile() || final.isSymbolicLink() || initial.dev !== final.dev || initial.ino !== final.ino
    || initial.size !== final.size || content.length !== entry.bytes || sha256(content) !== entry.sha256) {
    throw new Error(`Captured deployment entry changed: ${fullPath}`);
  }
  return content;
}

/** Recheck a deployment source against the bytes captured by createDeploymentInventory. */
export async function validateCapturedDeploymentInventory(inventory, { fs = fsApi } = {}) {
  if (!inventory || !Array.isArray(inventory.entries) || !Array.isArray(inventory.files)
    || inventory.entries.length !== inventory.files.length) throw new Error('Invalid deployment inventory');
  await assertNoSymlinkAncestors(inventory.root, { fs });
  for (const entry of inventory.entries) await readCapturedDeploymentEntry(inventory.root, entry, { fs });
  return true;
}

function isJavaScriptIdentifierCharacter(value) {
  return Boolean(value) && /[A-Za-z0-9_$]/.test(value);
}

function skipJavaScriptSpace(content, index) {
  while (/\s/.test(content[index] ?? '')) index += 1;
  return index;
}

function readJavaScriptString(content, index) {
  const quote = content[index];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let value = '';
  for (let cursor = index + 1; cursor < content.length; cursor += 1) {
    if (content[cursor] === '\\') {
      value += content[cursor + 1] ?? '';
      cursor += 1;
    } else if (content[cursor] === quote) {
      return { value, end: cursor + 1 };
    } else {
      value += content[cursor];
    }
  }
  return null;
}

function isLocalJavaScriptModuleReference(value) {
  return value.startsWith('.') || value.startsWith('/');
}

function collectJavaScriptFromReference(content, index, values) {
  for (let cursor = index; cursor < content.length && content[cursor] !== ';'; cursor += 1) {
    if ((content[cursor] === '"' || content[cursor] === "'") && readJavaScriptString(content, cursor)) {
      cursor = readJavaScriptString(content, cursor).end - 1;
      continue;
    }
    if (content.slice(cursor, cursor + 4) === 'from' && !isJavaScriptIdentifierCharacter(content[cursor - 1]) && !isJavaScriptIdentifierCharacter(content[cursor + 4])) {
      const string = readJavaScriptString(content, skipJavaScriptSpace(content, cursor + 4));
      if (string && isLocalJavaScriptModuleReference(string.value)) values.push(string.value);
      return;
    }
  }
}

function collectStaticStringArguments(content, index, values) {
  let cursor = skipJavaScriptSpace(content, index);
  if (content[cursor] !== '(') return;
  cursor += 1;
  while (cursor < content.length) {
    cursor = skipJavaScriptSpace(content, cursor);
    const string = readJavaScriptString(content, cursor);
    if (!string) return;
    values.push(string.value);
    cursor = skipJavaScriptSpace(content, string.end);
    if (content[cursor] === ')') return;
    if (content[cursor] !== ',') return;
    cursor += 1;
  }
}

function javascriptReferenceValues(content) {
  const values = [];
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' || character === "'" || character === '`') {
      const string = readJavaScriptString(content, index);
      index = string ? string.end - 1 : content.length;
      continue;
    }
    if (character === '/' && content[index + 1] === '/') {
      index = content.indexOf('\n', index + 2);
      if (index < 0) break;
      continue;
    }
    if (character === '/' && content[index + 1] === '*') {
      index = content.indexOf('*/', index + 2);
      if (index < 0) break;
      index += 1;
      continue;
    }
    const wordEnd = index + 6;
    if (content.slice(index, wordEnd) === 'import' && !isJavaScriptIdentifierCharacter(content[index - 1]) && !isJavaScriptIdentifierCharacter(content[wordEnd])) {
      const cursor = skipJavaScriptSpace(content, wordEnd);
      if (content[cursor] === '(') {
        const string = readJavaScriptString(content, skipJavaScriptSpace(content, cursor + 1));
        if (string && isLocalJavaScriptModuleReference(string.value)) values.push(string.value);
      } else if (content[cursor] === '"' || content[cursor] === "'") {
        const string = readJavaScriptString(content, cursor);
        if (string && isLocalJavaScriptModuleReference(string.value)) values.push(string.value);
      } else {
        // Static Vite imports are minified as import{...}from"./chunk.js".
        collectJavaScriptFromReference(content, cursor, values);
      }
      continue;
    }
    if (content.slice(index, index + 6) === 'export' && !isJavaScriptIdentifierCharacter(content[index - 1]) && !isJavaScriptIdentifierCharacter(content[index + 6])) {
      collectJavaScriptFromReference(content, skipJavaScriptSpace(content, index + 6), values);
      continue;
    }
    if (content.slice(index, index + 13) === 'importScripts' && !isJavaScriptIdentifierCharacter(content[index - 1]) && !isJavaScriptIdentifierCharacter(content[index + 13])) {
      collectStaticStringArguments(content, index + 13, values);
      continue;
    }
    if (content.slice(index, index + 3) === 'new' && !isJavaScriptIdentifierCharacter(content[index - 1]) && !isJavaScriptIdentifierCharacter(content[index + 3])) {
      let cursor = skipJavaScriptSpace(content, index + 3);
      if (content.slice(cursor, cursor + 3) === 'URL' && !isJavaScriptIdentifierCharacter(content[cursor + 3])) {
        cursor = skipJavaScriptSpace(content, cursor + 3);
        if (content[cursor] === '(') {
          const string = readJavaScriptString(content, skipJavaScriptSpace(content, cursor + 1));
          if (string) {
            const separator = skipJavaScriptSpace(content, string.end);
            const base = skipJavaScriptSpace(content, separator + 1);
            if (content[separator] === ',' && content.slice(base, base + 'import.meta.url'.length) === 'import.meta.url') values.push(string.value);
          }
        }
      }
    }
    if (content.slice(index, index + 6) === 'Worker' && !isJavaScriptIdentifierCharacter(content[index - 1]) && !isJavaScriptIdentifierCharacter(content[index + 6])) {
      let cursor = skipJavaScriptSpace(content, index + 6);
      if (content[cursor] === '(') cursor = skipJavaScriptSpace(content, cursor + 1);
      const string = readJavaScriptString(content, cursor);
      if (string) values.push(string.value);
    }
    if (content.slice(index, index + 12) === 'SharedWorker' && !isJavaScriptIdentifierCharacter(content[index - 1]) && !isJavaScriptIdentifierCharacter(content[index + 12])) {
      let cursor = skipJavaScriptSpace(content, index + 12);
      if (content[cursor] === '(') cursor = skipJavaScriptSpace(content, cursor + 1);
      const string = readJavaScriptString(content, cursor);
      if (string) values.push(string.value);
    }
  }
  return values;
}

function deploymentReferenceValues(content, file) {
  const values = javascriptReferenceValues(content);
  const collect = (expression) => {
    for (const match of content.matchAll(expression)) if (match[1] !== undefined) values.push(match[1]);
  };
  if (/\.html?$/i.test(file)) {
    collect(/\b(?:src|href|poster|data)\s*=\s*["']([^"']+)["']/gi);
    for (const match of content.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
      // A data URI can legally contain commas, so it is one candidate rather than a split delimiter.
      for (const candidate of match[1].matchAll(/(?:^|,)\s*(data:[^\s]+|[^\s,]+)(?:\s+[^,]+)?/gi)) values.push(candidate[1]);
    }
  }
  if (/\.css$/i.test(file)) {
    collect(/\burl\(\s*["']?([^"'()\s]+)["']?\s*\)/gi);
    collect(/\b@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?\s*\)?/gi);
  }
  if (/\.(?:m?js|cjs)$/i.test(file) && content.includes('__vite__mapDeps')) {
    // Vite's modulepreload helper keeps dependency paths in a static map array.
    for (const match of content.matchAll(/(?:__vite__mapDeps|\.f)\s*(?:=|\|\|)\s*\[([^\]]*)\]/g)) {
      for (const string of match[1].matchAll(/["']([^"']+)["']/g)) values.push(string[1]);
    }
    collect(/\/\/[#@]\s*sourceMappingURL\s*=\s*([^\s*]+)/g);
    collect(/\/\*[#@]\s*sourceMappingURL\s*=\s*([^\s*]+?)\s*\*\//g);
  }
  return values;
}

function referencePath(root, fromFile, reference) {
  if (/[\0-\x1f\x7f\\]/.test(reference)) throw new Error(`Malformed deployment reference in ${fromFile}`);
  if (reference.startsWith('#') || reference.startsWith('data:') || reference.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(reference)) return null;
  const rawPath = reference.split(/[?#]/, 1)[0];
  if (!rawPath) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new Error(`Malformed deployment reference in ${fromFile}: ${reference}`);
  }
  if (!decoded || /[\0-\x1f\x7f\\]/.test(decoded)) throw new Error(`Malformed deployment reference in ${fromFile}: ${reference}`);
  const destination = decoded.startsWith('/') ? resolve(root, `.${decoded}`) : resolve(dirname(join(root, fromFile)), decoded);
  if (!isInside(root, destination)) throw new Error(`Reference escapes deployment source in ${fromFile}: ${reference}`);
  return relative(root, destination).split(sep).join('/');
}

/** Shared deployment/release reference closure validation for Vite output. */
export async function validateDeploymentReferences(root, files, { fs = fsApi, capturedEntries } = {}) {
  const knownFiles = new Set(files);
  for (const file of files) {
    const captured = capturedEntries?.get(file);
    const content = captured === undefined ? await fs.readFile(join(root, file), 'utf8') : Buffer.from(captured).toString('utf8');
    if (/["'(]\s*\/(?:src|assets)\/|@vite\/client|https?:\/\/localhost(?::\d+)?/i.test(content)) throw new Error(`Unstable or development reference in ${file}`);
    for (const reference of deploymentReferenceValues(content, file)) {
      const destination = referencePath(root, file, reference);
      if (destination !== null && !knownFiles.has(destination)) throw new Error(`Missing referenced deployment asset in ${file}: ${reference}`);
    }
  }
}

export async function createDeploymentInventory(source, manifest, { fs = fsApi, packageVersion } = {}) {
  const root = resolve(source);
  await assertNoSymlinkAncestors(root, { fs });
  const sourceInfo = await checkedLstat(root, fs);
  if (!sourceInfo || !sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error(`Deployment source must be a real directory: ${root}`);
  const supportDirectory = manifest.artifact.supportTree.slice(0, -3);
  const expectedPages = new Set(manifest.artifact.stableEntries);
  const topLevel = await fs.readdir(root, { withFileTypes: true });
  const seenPages = new Set();
  for (const entry of topLevel) {
    const path = join(root, entry.name);
    const information = await fs.lstat(path);
    if (information.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${path}`);
    if (information.isFile() && expectedPages.has(entry.name)) seenPages.add(entry.name);
    else if (!information.isDirectory() || entry.name !== supportDirectory) throw new Error(`Unexpected top-level deployment entry: ${entry.name}`);
  }
  for (const page of manifest.artifact.stableEntries) if (!seenPages.has(page)) throw new Error(`Missing stable entry page: ${page}`);
  const supportPath = join(root, supportDirectory);
  const supportInfo = await checkedLstat(supportPath, fs);
  if (!supportInfo?.isDirectory() || supportInfo.isSymbolicLink()) throw new Error(`Missing support tree: ${supportDirectory}`);
  const supportTree = await walkTree(supportPath, supportDirectory, { fs });
  if (supportTree.files.length === 0) throw new Error(`Support tree is empty: ${supportDirectory}`);
  const files = [...manifest.artifact.stableEntries, ...supportTree.files].sort();
  if (!files.includes(`${supportDirectory}/nodel-webui.js`)) throw new Error(`Missing stable loader chunk: ${supportDirectory}/nodel-webui.js`);
  if (!files.includes(componentContractPath)) throw new Error(`Missing component contract: ${componentContractPath}`);
  const entries = [];
  for (const path of files) entries.push(await makeFileEntry(root, path, { fs }));
  const capturedEntries = new Map();
  for (const entry of entries) capturedEntries.set(entry.path, await readCapturedDeploymentEntry(root, entry, { fs }));
  const contractEntry = entries.find((entry) => entry.path === componentContractPath);
  validateComponentContractArtifact(capturedEntries.get(contractEntry.path), packageVersion ?? JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version);
  await validateDeploymentReferences(root, files, { fs, capturedEntries });
  return Object.freeze({
    root,
    supportDirectory,
    files,
    entries: Object.freeze(entries),
    inventorySha256: sha256(JSON.stringify(entries)),
    directories: Object.freeze(supportTree.directories),
    supportFiles: supportTree.files,
    pageFiles: [...manifest.artifact.stableEntries]
  });
}

async function git(checkout, args) {
  try {
    return await execFileAsync('git', ['-C', checkout, ...args], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`Invalid Java checkout ${checkout}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function normalizeGitHubRepository(remote) {
  if (typeof remote !== 'string' || !remote || /[\s\0]/.test(remote)) return null;
  let path;
  const shorthand = remote.match(/^github:([^/]+)\/([^/]+)$/i);
  const scp = remote.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  const url = remote.match(/^(?:https?|git|ssh):\/\/(?:git@)?github\.com\/([^/]+)\/([^/]+)$/i);
  const bare = remote.match(/^github\.com\/([^/]+)\/([^/]+)$/i);
  const identity = remote.match(/^([^/]+)\/([^/]+)$/i);
  if (shorthand) path = [shorthand[1], shorthand[2]];
  else if (scp) path = [scp[1], scp[2]];
  else if (url) path = [url[1], url[2]];
  else if (bare) path = [bare[1], bare[2]];
  else if (identity) path = [identity[1], identity[2]];
  else return null;
  const [owner, repositoryWithSuffix] = path;
  const repository = repositoryWithSuffix.replace(/\.git$/i, '');
  if (!owner || !repository || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) return null;
  return `${owner}/${repository}`.toLowerCase();
}

function statusPaths(status) {
  const records = status.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) throw new Error('Invalid git status record');
    paths.push(record.slice(3));
    if ('RC'.includes(record[0]) || 'RC'.includes(record[1])) paths.push(records[++index] ?? '');
  }
  return paths;
}

function allowedGeneratedJavaPath(path) {
  return path.startsWith('build/') || path.startsWith('.gradle/');
}

function requiredDirectoriesFor(files) {
  const directories = new Set();
  for (const file of files) {
    let current = dirname(file);
    while (current !== '.') {
      directories.add(current.split(sep).join('/'));
      current = dirname(current);
    }
  }
  return [...directories].sort();
}

async function javaGitSnapshot(checkout) {
  const branch = (await git(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
  const commit = (await git(checkout, ['rev-parse', 'HEAD'])).stdout.trim();
  const status = (await git(checkout, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
  return { branch, commit, status };
}

function snapshotDirtyPaths(snapshot) {
  const dirtyPaths = statusPaths(snapshot.status);
  return {
    dirtyPaths,
    ignoredDirtyPaths: dirtyPaths.filter(allowedGeneratedJavaPath).sort(),
    disallowedDirtyPaths: dirtyPaths.filter((path) => !allowedGeneratedJavaPath(path)).sort()
  };
}

function canonicalJavaHandoffEvidenceFields(report) {
  return {
    repository: report.repository,
    branch: report.branch,
    commit: report.commit,
    manifestSha256: report.manifestSha256,
    ignoredDirtyPaths: [...report.ignoredDirtyPaths].sort(),
    v1Files: report.v1Files.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })),
    v1Directories: [...report.v1Directories],
    v1InventorySha256: report.v1InventorySha256,
    collisions: [...report.collisions],
    approvedCollisions: [...report.approvedCollisions]
  };
}

export function canonicalJavaHandoffEvidence(report) {
  return Object.freeze(canonicalJavaHandoffEvidenceFields(report));
}

export function sameJavaHandoffEvidence(left, right) {
  return left.canonicalEvidenceSha256 === right.canonicalEvidenceSha256
    && JSON.stringify(left.canonicalEvidence) === JSON.stringify(right.canonicalEvidence);
}

function validHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateJavaInventoryEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Java handoff V1 inventory is invalid');
  let previous = '';
  for (const entry of entries) {
    if (!sameKeys(entry, ['path', 'bytes', 'sha256']) || !safeRelativePath(entry.path) || entry.path <= previous
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !validHash(entry.sha256)) {
      throw new Error('Java handoff V1 inventory is invalid');
    }
    previous = entry.path;
  }
}

function canonicalJavaEvidenceFromNormalized(report) {
  return {
    repository: report.repository,
    branch: report.branch,
    commit: report.commit,
    manifestSha256: report.deploymentManifestSha256,
    ignoredDirtyPaths: [...report.ignoredDirtyPaths],
    v1Files: report.v1.files.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })),
    v1Directories: [...report.v1.directories],
    v1InventorySha256: report.v1.inventorySha256,
    collisions: [...report.collisions],
    approvedCollisions: [...report.collisions]
  };
}

function validateCanonicalJavaEvidence(evidence, expected) {
  if (!sameKeys(evidence, ['repository', 'branch', 'commit', 'manifestSha256', 'ignoredDirtyPaths', 'v1Files', 'v1Directories', 'v1InventorySha256', 'collisions', 'approvedCollisions'])
    || JSON.stringify(evidence) !== JSON.stringify(expected)) {
    throw new Error('Java handoff canonical evidence does not match the report');
  }
}

/**
 * Validate either the complete verify-java-handoff report or the deterministic
 * report packaged in a release, then return the latter form. Keeping both
 * forms here prevents the producer and release consumer from drifting.
 */
export function normalizeJavaHandoffReport(input, { role, manifest, manifestHash }) {
  if (!['dev', 'master'].includes(role) || !manifest || !validHash(manifestHash)) throw new Error('Invalid Java handoff normalization contract');
  const normalizedKeys = ['schemaVersion', 'role', 'branch', 'commit', 'repository', 'deploymentManifestSha256', 'ignoredDirtyPaths', 'disallowedDirtyPaths', 'collisions', 'v1', 'canonicalEvidence', 'canonicalEvidenceSha256'];
  const fullKeys = ['javaCheckout', 'canonicalJavaCheckout', 'branch', 'commit', 'repository', 'repositoryRemote', 'manifestSha256', 'ignoredDirtyPaths', 'disallowedDirtyPaths', 'v1Source', 'canonicalV1Source', 'v1Files', 'v1Directories', 'v1InventorySha256', 'v1FileCount', 'protectedV1FileCount', 'collisions', 'approvedCollisions', 'canonicalEvidence', 'canonicalEvidenceSha256'];
  let report;
  if (sameKeys(input, fullKeys)) {
    if (typeof input.javaCheckout !== 'string' || !isAbsolute(input.javaCheckout)
      || typeof input.canonicalJavaCheckout !== 'string' || !isAbsolute(input.canonicalJavaCheckout)
      || resolve(input.v1Source) !== resolve(input.javaCheckout, manifest.java.v1Source)
      || resolve(input.canonicalV1Source) !== resolve(input.canonicalJavaCheckout, manifest.java.v1Source)
      || normalizeGitHubRepository(input.repositoryRemote) !== manifest.java.repository
      || input.manifestSha256 !== manifestHash || input.v1FileCount !== input.v1Files.length
      || input.protectedV1FileCount !== input.v1Files.length - input.collisions.length
      || !Array.isArray(input.approvedCollisions) || input.approvedCollisions.join('\0') !== manifest.v1.collisions.map((collision) => collision.path).sort().join('\0')) {
      throw new Error(`Java ${role} full report does not match the deployment contract`);
    }
    report = {
      schemaVersion: 1,
      role,
      branch: input.branch,
      commit: input.commit,
      repository: input.repository,
      deploymentManifestSha256: input.manifestSha256,
      ignoredDirtyPaths: input.ignoredDirtyPaths,
      disallowedDirtyPaths: input.disallowedDirtyPaths,
      collisions: input.collisions,
      v1: { files: input.v1Files, directories: input.v1Directories, inventorySha256: input.v1InventorySha256 },
      canonicalEvidence: input.canonicalEvidence,
      canonicalEvidenceSha256: input.canonicalEvidenceSha256
    };
  } else if (sameKeys(input, normalizedKeys)) {
    report = input;
  } else {
    throw new Error(`Java ${role} report has unexpected keys`);
  }
  if (report.schemaVersion !== 1 || report.role !== role || report.branch !== role || !/^[0-9a-f]{40}$/.test(report.commit)
    || report.repository !== manifest.java.repository || normalizeGitHubRepository(report.repository) !== manifest.java.repository
    || report.deploymentManifestSha256 !== manifestHash || !Array.isArray(report.ignoredDirtyPaths)
    || report.ignoredDirtyPaths.some((path) => !safeRelativePath(path)) || !Array.isArray(report.disallowedDirtyPaths)
    || report.disallowedDirtyPaths.length !== 0 || !Array.isArray(report.collisions)
    || report.collisions.join('\0') !== manifest.v1.collisions.map((collision) => collision.path).sort().join('\0')
    || !sameKeys(report.v1, ['files', 'directories', 'inventorySha256']) || !Array.isArray(report.v1.directories)
    || report.v1.directories.some((path) => !safeRelativePath(path)) || !validHash(report.v1.inventorySha256)
    || !validHash(report.canonicalEvidenceSha256)) {
    throw new Error(`Java ${role} report does not match the deployment contract`);
  }
  validateJavaInventoryEntries(report.v1.files);
  if (report.v1.files.filter((entry) => manifest.artifact.stableEntries.includes(entry.path)).map((entry) => entry.path).join('\0')
    !== manifest.v1.collisions.map((collision) => collision.path).sort().join('\0')) {
    throw new Error(`Java ${role} report collisions do not match its V1 inventory`);
  }
  if (report.v1.directories.join('\0') !== [...report.v1.directories].sort().join('\0')
    || new Set(report.v1.directories).size !== report.v1.directories.length
    || report.ignoredDirtyPaths.join('\0') !== [...report.ignoredDirtyPaths].sort().join('\0')
    || new Set(report.ignoredDirtyPaths).size !== report.ignoredDirtyPaths.length) {
    throw new Error(`Java ${role} report lists are not canonical`);
  }
  if (sha256(JSON.stringify({ files: report.v1.files, directories: report.v1.directories })) !== report.v1.inventorySha256) {
    throw new Error(`Java ${role} report V1 inventory hash is invalid`);
  }
  const normalized = {
    schemaVersion: 1,
    role,
    branch: role,
    commit: report.commit,
    repository: manifest.java.repository,
    deploymentManifestSha256: manifestHash,
    ignoredDirtyPaths: [...report.ignoredDirtyPaths],
    disallowedDirtyPaths: [],
    collisions: [...report.collisions],
    v1: { files: report.v1.files, directories: [...report.v1.directories], inventorySha256: report.v1.inventorySha256 }
  };
  const canonicalEvidence = canonicalJavaEvidenceFromNormalized(normalized);
  validateCanonicalJavaEvidence(report.canonicalEvidence, canonicalEvidence);
  if (sha256(JSON.stringify(canonicalEvidence)) !== report.canonicalEvidenceSha256) {
    throw new Error(`Java ${role} report canonical evidence hash is invalid`);
  }
  return Object.freeze({ ...normalized, canonicalEvidence: Object.freeze(canonicalEvidence), canonicalEvidenceSha256: report.canonicalEvidenceSha256 });
}

export async function verifyJavaHandoff({ javaCheckout, manifest, expectedBranch, manifestHash }) {
  if (expectedBranch !== undefined && !['dev', 'master'].includes(expectedBranch)) throw new Error('Expected Java branch must be dev or master');
  const checkout = resolve(javaCheckout);
  await assertNoSymlinkAncestors(checkout);
  const checkoutInfo = await checkedLstat(checkout);
  if (!checkoutInfo?.isDirectory() || checkoutInfo.isSymbolicLink()) throw new Error(`Java checkout must be a real directory: ${checkout}`);
  const canonicalCheckout = await realpath(checkout);
  if ((await git(checkout, ['rev-parse', '--is-inside-work-tree'])).stdout.trim() !== 'true') throw new Error(`Not a git checkout: ${checkout}`);
  const initialSnapshot = await javaGitSnapshot(checkout);
  const { commit, branch } = initialSnapshot;
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Java checkout has an invalid commit: ${checkout}`);
  if (!branch) throw new Error('Java checkout must be on a branch, not a detached HEAD');
  if (expectedBranch && branch !== expectedBranch) throw new Error(`Java checkout branch ${branch} does not match expected ${expectedBranch}`);
  const repositoryRemote = (await git(checkout, ['remote', 'get-url', 'origin'])).stdout.trim();
  if (!repositoryRemote || /[\r\n\0]/.test(repositoryRemote)) throw new Error('Java checkout must define a single-line origin remote');
  const repository = normalizeGitHubRepository(repositoryRemote);
  const expectedRepository = normalizeGitHubRepository(manifest.java.repository);
  if (!repository || !expectedRepository || repository !== expectedRepository) {
    throw new Error(`Java checkout origin must match canonical repository ${manifest.java.repository}`);
  }
  const initialStatus = snapshotDirtyPaths(initialSnapshot);
  if (initialStatus.disallowedDirtyPaths.length) throw new Error(`Java checkout is not clean: ${initialStatus.disallowedDirtyPaths.join(', ')}`);
  const source = resolve(checkout, manifest.java.v1Source);
  await assertNoSymlinkAncestors(source);
  const canonicalSource = await canonicalPotential(source);
  if (!isInside(canonicalCheckout, canonicalSource)) throw new Error('Java V1 source escapes checkout');
  const sourceInfo = await checkedLstat(source);
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error(`Missing Java V1 source: ${source}`);
  for (const required of [join(dirname(source), 'Gruntfile.js'), join(checkout, 'build.gradle')]) {
    const info = await checkedLstat(required);
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Missing Java packaging file: ${required}`);
  }
  const tree = await walkTree(source);
  const v1Files = [];
  for (const path of tree.files) v1Files.push(await makeFileEntry(source, path));
  const supportRoot = manifest.artifact.supportTree.slice(0, -3);
  const exactFileCollisions = v1Files.filter((entry) => manifest.artifact.stableEntries.includes(entry.path)).map((entry) => entry.path);
  const structuralCollisions = [
    ...tree.directories.filter((path) => manifest.artifact.stableEntries.includes(path)).map((path) => `${path}/`),
    ...v1Files.filter((entry) => entry.path === supportRoot || entry.path.startsWith(`${supportRoot}/`)).map((entry) => entry.path),
    ...tree.directories.filter((path) => path === supportRoot).map((path) => `${path}/`)
  ].sort();
  const collisions = exactFileCollisions.sort();
  const approved = manifest.v1.collisions.map((collision) => collision.path).sort();
  if (collisions.join('\0') !== approved.join('\0') || structuralCollisions.length) {
    throw new Error(`Java V1 collisions do not exactly match manifest approval; files ${collisions.join(', ') || 'none'}, structural ${structuralCollisions.join(', ') || 'none'}, expected ${approved.join(', ') || 'none'}`);
  }
  const protectedV1Files = v1Files.filter((entry) => !approved.includes(entry.path));
  const finalSnapshot = await javaGitSnapshot(checkout);
  const finalStatus = snapshotDirtyPaths(finalSnapshot);
  const finalRepositoryRemote = (await git(checkout, ['remote', 'get-url', 'origin'])).stdout.trim();
  if (initialSnapshot.branch !== finalSnapshot.branch || initialSnapshot.commit !== finalSnapshot.commit || initialSnapshot.status !== finalSnapshot.status) {
    throw new Error('Java checkout changed while capturing the V1 snapshot');
  }
  if (repositoryRemote !== finalRepositoryRemote) throw new Error('Java checkout origin changed while capturing the V1 snapshot');
  if (finalStatus.disallowedDirtyPaths.length) throw new Error(`Java checkout is not clean: ${finalStatus.disallowedDirtyPaths.join(', ')}`);
  const report = {
    javaCheckout: checkout,
    canonicalJavaCheckout: canonicalCheckout,
    branch,
    commit,
    repository,
    repositoryRemote,
    manifestSha256: manifestHash ?? sha256(JSON.stringify(manifest)),
    ignoredDirtyPaths: initialStatus.ignoredDirtyPaths,
    disallowedDirtyPaths: [],
    v1Source: source,
    canonicalV1Source: canonicalSource,
    v1Files: Object.freeze(v1Files),
    v1Directories: Object.freeze(tree.directories),
    v1InventorySha256: sha256(JSON.stringify({ files: v1Files, directories: tree.directories })),
    v1FileCount: v1Files.length,
    protectedV1FileCount: protectedV1Files.length,
    collisions,
    approvedCollisions: approved
  };
  const canonicalEvidence = canonicalJavaHandoffEvidenceFields(report);
  return Object.freeze({
    ...report,
    canonicalEvidence: Object.freeze(canonicalEvidence),
    canonicalEvidenceSha256: sha256(JSON.stringify(canonicalEvidence))
  });
}

export async function assertProjectBuildTarget(target, { source, javaCheckout, roots = {}, fs = fsApi } = {}) {
  const configuredProjectRoot = resolve(roots.projectRoot ?? projectRoot);
  const configuredBuildRoot = resolve(roots.buildRoot ?? join(configuredProjectRoot, 'build'));
  const resolvedTarget = resolve(target);
  if (resolvedTarget === configuredBuildRoot || !isInside(configuredBuildRoot, resolvedTarget)) throw new Error(`Deployment target must be below the project build directory: ${resolvedTarget}`);
  await assertNoSymlinkAncestors(configuredProjectRoot, { fs });
  await assertNoSymlinkAncestors(configuredBuildRoot, { fs });
  await assertNoSymlinkAncestors(resolvedTarget, { fs });
  const canonicalProject = await canonicalPotential(configuredProjectRoot, fs);
  const canonicalBuild = await canonicalPotential(configuredBuildRoot, fs);
  const canonicalTarget = await canonicalPotential(resolvedTarget, fs);
  if (!isInside(canonicalProject, canonicalBuild) || !isInside(canonicalBuild, canonicalTarget)) throw new Error(`Deployment target resolves outside canonical project build directory: ${resolvedTarget}`);
  if (source) {
    await assertNoSymlinkAncestors(source, { fs });
    const canonicalSource = await canonicalPotential(source, fs);
    if (isInside(canonicalTarget, canonicalSource) || isInside(canonicalSource, canonicalTarget)) throw new Error(`Deployment target must not contain or be contained by the source: ${resolvedTarget}`);
  }
  if (javaCheckout) {
    await assertNoSymlinkAncestors(javaCheckout, { fs });
    const canonicalJava = await canonicalPotential(javaCheckout, fs);
    if (isInside(canonicalTarget, canonicalJava) || isInside(canonicalJava, canonicalTarget)) throw new Error(`Deployment target must not contain or be contained by the Java checkout: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function validMarkerEntry(entry, previous) {
  return sameKeys(entry, ['path', 'bytes', 'sha256']) && safeRelativePath(entry.path) && entry.path > previous
    && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && /^[0-9a-f]{64}$/.test(entry.sha256);
}

export function deploymentMarker(manifestData, inventory) {
  return {
    schemaVersion: markerSchemaVersion,
    manifestSha256: manifestData.hash,
    supportSubdir: inventory.supportDirectory,
    inventorySha256: inventory.inventorySha256,
    files: inventory.entries
  };
}

/** Verify that a post-hook staging directory is exactly the captured deployment. */
export async function validateStagedDeployment(stage, manifestData, inventory, { fs = fsApi } = {}) {
  const state = await targetState(stage, manifestData, { fs });
  const expectedMarker = deploymentMarker(manifestData, inventory);
  const expectedMarkerText = `${JSON.stringify(expectedMarker, null, 2)}\n`;
  const markerText = await fs.readFile(join(stage, markerName), 'utf8');
  if (!state.managed || markerText !== expectedMarkerText || JSON.stringify(state.marker) !== JSON.stringify(expectedMarker)) {
    throw new Error('Staged deployment marker does not match the captured deployment inventory');
  }
  return state;
}

async function genericTreeHash(root, { fs = fsApi } = {}) {
  const tree = await walkTree(root, '', { fs });
  const files = [];
  for (const path of tree.files) files.push(await makeFileEntry(root, path, { fs }));
  return { tree, hash: sha256(JSON.stringify({ files, directories: tree.directories })) };
}

export async function targetState(target, manifestData, { fs = fsApi } = {}) {
  const information = await checkedLstat(target, fs);
  if (!information) return { exists: false, empty: true, managed: false, identity: { absent: true, markerSha256: null, treeSha256: null } };
  if (!information.isDirectory() || information.isSymbolicLink()) throw new Error(`Deployment target must be a real directory: ${target}`);
  const identityBase = { dev: String(information.dev), ino: String(information.ino) };
  const treeHash = await genericTreeHash(target, { fs });
  if (treeHash.tree.files.length === 0 && treeHash.tree.directories.length === 0) return { exists: true, empty: true, managed: false, identity: { ...identityBase, markerSha256: null, treeSha256: treeHash.hash } };
  const markerPath = join(target, markerName);
  const markerInfo = await checkedLstat(markerPath, fs);
  if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) return { exists: true, empty: false, managed: false, identity: { ...identityBase, markerSha256: null, treeSha256: treeHash.hash } };
  let markerText;
  let marker;
  try {
    markerText = await fs.readFile(markerPath, 'utf8');
    marker = JSON.parse(markerText);
  } catch {
    throw new Error(`Invalid managed deployment marker: ${markerPath}`);
  }
  if (!sameKeys(marker, ['schemaVersion', 'manifestSha256', 'supportSubdir', 'inventorySha256', 'files'])
    || marker.schemaVersion !== markerSchemaVersion || marker.manifestSha256 !== manifestData.hash
    || marker.supportSubdir !== manifestData.manifest.artifact.supportTree.slice(0, -3) || !Array.isArray(marker.files)) {
    throw new Error(`Managed deployment marker does not match current manifest: ${markerPath}`);
  }
  let previous = '';
  for (const entry of marker.files) {
    if (!validMarkerEntry(entry, previous)) throw new Error(`Invalid managed deployment marker inventory: ${markerPath}`);
    previous = entry.path;
  }
  if (sha256(JSON.stringify(marker.files)) !== marker.inventorySha256) throw new Error(`Managed deployment marker inventory hash is invalid: ${markerPath}`);
  const listedFiles = marker.files.map((entry) => entry.path);
  const supportPrefix = `${marker.supportSubdir}/`;
  const markerPages = listedFiles.filter((path) => !path.startsWith(supportPrefix));
  const markerSupportFiles = listedFiles.filter((path) => path.startsWith(supportPrefix));
  if (markerPages.join('\0') !== manifestData.manifest.artifact.stableEntries.join('\0') || markerSupportFiles.length === 0) {
    throw new Error(`Managed deployment marker does not declare the canonical pages and support root: ${markerPath}`);
  }
  const expectedFiles = [...listedFiles, markerName].sort();
  const expectedDirectories = requiredDirectoriesFor(listedFiles);
  if (treeHash.tree.files.join('\0') !== expectedFiles.join('\0') || treeHash.tree.directories.join('\0') !== expectedDirectories.join('\0')) {
    throw new Error(`Managed deployment target tree does not exactly match marker: ${target}`);
  }
  for (const entry of marker.files) {
    const actual = await makeFileEntry(target, entry.path, { fs });
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error(`Managed deployment file does not match marker: ${entry.path}`);
  }
  return {
    exists: true,
    empty: false,
    managed: true,
    marker,
    identity: { ...identityBase, markerSha256: sha256(markerText), treeSha256: treeHash.hash }
  };
}

export function sameTargetIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function filesMatch(source, target, entries, { fs = fsApi } = {}) {
  for (const entry of entries) {
    const sourceEntry = await makeFileEntry(source, entry.path, { fs });
    const targetEntry = await makeFileEntry(target, entry.path, { fs });
    if (sourceEntry.bytes !== entry.bytes || sourceEntry.sha256 !== entry.sha256 || targetEntry.bytes !== entry.bytes || targetEntry.sha256 !== entry.sha256) return false;
  }
  return true;
}
