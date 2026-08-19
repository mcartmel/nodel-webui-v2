import { lstat, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { validateIconArtifactFiles } from './icon-artifact.mjs';

const privatePattern = /(?:fontawesome[-_]?pro(?:[-_]?[a-z0-9]+)*|@fortawesome\/(?:pro|sharp|duotone|private)(?:[-_/]|$)|npm\.fontawesome\.com|fontawesome\.com|_authToken|FONTAWESOME_PACKAGE_TOKEN)/i;

function privatePackageName(value) {
  if (typeof value !== 'string') return false;
  const name = value.replaceAll('\\', '/');
  return /(?:^|\/)@fortawesome\/(?:pro|sharp|duotone|private)(?:[-_][a-z0-9]+)*(?:$|\/)/i.test(name)
    || /(?:^|\/)fontawesome[-_]?pro(?:[-_][a-z0-9]+)*(?:$|\/)/i.test(name);
}

function privateLockValue(value, path = 'package-lock.json') {
  if (typeof value === 'string') return privatePattern.test(value) || privatePackageName(value) ? path : null;
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (privatePackageName(key) || privatePattern.test(key)) return `${path}.${key}`;
    const result = privateLockValue(child, `${path}.${key}`);
    if (result) return result;
  }
  return null;
}

async function enumerateIconFiles(root) {
  const iconRoot = resolve(root, 'v2/icons');
  const files = [];
  async function visit(directory) {
    const information = await lstat(directory).catch(() => null);
    if (!information?.isDirectory() || information.isSymbolicLink()) throw new Error(`Public icon directory must be a regular directory: ${directory}`);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(directory, entry.name);
      const item = await lstat(path);
      if (item.isSymbolicLink()) throw new Error(`Public icon artifact must not be a symlink: ${path}`);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) {
        if (!entry.name.endsWith('.json')) throw new Error(`Public icon artifact must be JSON: ${path}`);
        files.push(relative(root, path).split(sep).join('/'));
      } else throw new Error(`Public icon artifact must be a regular file: ${path}`);
    }
  }
  await visit(iconRoot);
  return files;
}

export async function verifyPublicRelease({ projectRoot = process.cwd(), distRoot = resolve(projectRoot, 'dist') } = {}) {
  const root = resolve(projectRoot);
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  const privateNames = Object.keys(lock.packages ?? {}).filter(privatePackageName);
  if (privateNames.length) throw new Error(`Public dependency graph contains private Font Awesome packages: ${privateNames.join(', ')}`);
  const packageFinding = privateLockValue(packageJson, 'package.json');
  const lockFinding = privateLockValue(lock, 'package-lock.json');
  if (packageFinding || lockFinding) throw new Error(`Public dependency manifests contain private Font Awesome registry or package configuration: ${packageFinding ?? lockFinding}`);
  for (const path of ['.npmrc', 'npmrc']) {
    try { const config = await readFile(resolve(root, path), 'utf8'); if (privatePattern.test(config)) throw new Error(`Public root contains private registry configuration: ${path}`); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const indexBytes = await readFile(resolve(distRoot, 'v2/nodel-icons.json'));
  const indexInfo = await lstat(resolve(distRoot, 'v2/nodel-icons.json'));
  if (!indexInfo.isFile() || indexInfo.isSymbolicLink()) throw new Error('Public icon catalogue index must be a regular file');
  const actualIconFiles = await enumerateIconFiles(distRoot);
  const files = new Map([['v2/nodel-icons.json', indexBytes]]);
  for (const path of actualIconFiles) files.set(path, await readFile(resolve(distRoot, path)));
  const packageMetadata = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
  validateIconArtifactFiles(indexBytes, files, { expectedProfile: 'free', expectedPackageVersion: packageMetadata.version });
  const declared = new Set(validateIconArtifactFiles(indexBytes, files, { expectedProfile: 'free', expectedPackageVersion: packageMetadata.version }).paths);
  if (actualIconFiles.some(path => !declared.has(path))) throw new Error('Public dist contains an undeclared icon artifact');
  return { profile: 'free', privateNames: [], iconFiles: files.size };
}

if (process.argv[1]?.endsWith('verify-public-release.mjs')) verifyPublicRelease().then(report => console.log(JSON.stringify(report))).catch(error => { console.error(error.message); process.exitCode = 1; });
