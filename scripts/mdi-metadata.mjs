import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MDI_PACKAGE = '@mdi/svg';
export const MDI_VERSION = '7.4.47';
const CANONICAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODEPOINT = /^F[0-9A-F]{3,5}$/;
const MAX_METADATA_TEXT = 128;
const MAX_PATH_DATA = 64 * 1024;
const MAX_SVG_BYTES = 128 * 1024;
const MAX_PACKAGE_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_LOCK_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_ENTRIES = 10000;
// Match the artifact's officialAliases/ligatures and search-term limits. Fail
// rather than silently truncating upstream data if a future source exceeds them.
const MAX_ALIASES = 32;
const MAX_SEARCH_TERMS = 128;
const PATH_ARITY = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

function fail(message) { throw new Error(`Invalid ${MDI_PACKAGE} metadata: ${message}`); }

const isBrand = entry => entry.tags.some(tag => tag.toLowerCase() === 'brand / logo');
const compareNames = (left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
function sortedUnique(values, max, description) {
  const result = [...new Set(values)].sort();
  if (result.length > max) fail(`${description} exceeds ${max} unique values`);
  return result;
}

// Check the opened file, then cap actual reads too: a file may grow after stat.
// Never readFile() an untrusted-size file and only check its size afterwards.
async function readBoundedText(path, maxBytes) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) fail(`${path} exceeds ${maxBytes} byte limit or is not a regular file`);
    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) fail(`${path} exceeds ${maxBytes} byte limit`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    await file.close();
  }
}

function metadataEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`entry ${index} must be an object`);
  if (typeof entry.name !== 'string' || entry.name.length > MAX_METADATA_TEXT || !CANONICAL_NAME.test(entry.name)) fail(`entry ${index} has invalid canonical name`);
  if (typeof entry.codepoint !== 'string' || !CODEPOINT.test(entry.codepoint)) fail(`${entry.name} has invalid codepoint`);
  if (Number.parseInt(entry.codepoint, 16) > 0x10ffff) fail(`${entry.name} has out-of-range codepoint`);
  if (!Array.isArray(entry.tags) || entry.tags.length > 64 || entry.tags.some(tag => typeof tag !== 'string' || !tag.length || tag.length > MAX_METADATA_TEXT || tag.trim() !== tag || CONTROL_CHARACTERS.test(tag))) fail(`${entry.name} has invalid category metadata`);
  if (!Array.isArray(entry.aliases) || entry.aliases.length > 256 || entry.aliases.some(alias => typeof alias !== 'string' || alias.length > MAX_METADATA_TEXT || !CANONICAL_NAME.test(alias))) fail(`${entry.name} has invalid aliases`);
  if (entry.deprecated !== undefined && typeof entry.deprecated !== 'boolean') fail(`${entry.name} has invalid deprecated flag`);
  return entry;
}

// SVG path grammar, not merely a character allowlist. Each command needs one or
// more complete argument groups (except closepath); moveto's extra pairs are
// implicit lineto pairs. A sticky numeric lexer accounts for *every* character,
// including exponent syntax, comma-wsp, adjacent signs/decimals and arc flags.
function validatePath(data, expectedName) {
  const invalid = () => fail(`${expectedName} SVG has malformed or out-of-bounds path data`);
  if (data.length > MAX_PATH_DATA || CONTROL_CHARACTERS.test(data)) invalid();
  const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  let position = 0;
  const skipSpace = () => { while (data[position] === ' ') position += 1; };
  skipSpace();
  if (data[position] !== 'M' && data[position] !== 'm') invalid();
  while (position < data.length) {
    const command = data[position++].toLowerCase();
    if (!Object.hasOwn(PATH_ARITY, command)) invalid();
    const arity = PATH_ARITY[command];
    if (arity > 0) {
      let groups = 0;
      do {
        for (let argument = 0; argument < arity; argument += 1) {
          skipSpace();
          if (data[position] === ',' && (argument > 0 || groups > 0)) {
            position += 1;
            skipSpace();
          }
          if (command === 'a' && (argument === 3 || argument === 4)) {
            // Flags are single digits, not general numbers (01 may be two flags).
            if (data[position] !== '0' && data[position] !== '1') invalid();
            position += 1;
          } else {
            // Arc radii use SVG's nonnegative-number production, without signs.
            if (command === 'a' && argument < 2 && (data[position] === '-' || data[position] === '+')) invalid();
            number.lastIndex = position;
            const token = number.exec(data);
            if (!token || !Number.isFinite(Number(token[0])) || Math.abs(Number(token[0])) > 100000) invalid();
            position = number.lastIndex;
          }
        }
        groups += 1;
        skipSpace();
      } while (position < data.length && !Object.hasOwn(PATH_ARITY, data[position].toLowerCase()));
    }
    skipSpace();
  }
}

function parseSvg(svg, expectedName) {
  if (typeof svg !== 'string') fail(`${expectedName} SVG is not text`);
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES || CONTROL_CHARACTERS.test(svg)) fail(`${expectedName} SVG exceeds supported text bounds`);
  const root = /^\s*<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" id="mdi-([a-z0-9-]+)" viewBox="0 0 24 24">([\s\S]*?)<\/svg>\s*$/.exec(svg);
  if (!root || root[1] !== expectedName) fail(`${expectedName} SVG has an unexpected root or attributes`);
  const body = root[2];
  const paths = [];
  const pathPattern = /\s*<path d="([^"]+)"\s*\/>/gy;
  let position = 0;
  while (position < body.length) {
    pathPattern.lastIndex = position;
    const match = pathPattern.exec(body);
    if (!match) fail(`${expectedName} SVG contains unsupported or malformed markup`);
    validatePath(match[1], expectedName);
    paths.push(match[1]);
    position = pathPattern.lastIndex;
  }
  if (paths.length !== 1) fail(`${expectedName} SVG must contain exactly one path`);
  return { width: 24, height: 24, paths };
}

/**
 * Normalize upstream metadata into validated neutral records and an in-memory
 * report. Persisting that report belongs to stage-2 generation integration.
 */
export async function normalizeMdiMetadata({ metadata, readSvg }) {
  if (!Array.isArray(metadata) || metadata.length === 0 || metadata.length > MAX_METADATA_ENTRIES) fail(`meta.json must be a non-empty array of at most ${MAX_METADATA_ENTRIES} entries`);
  if (typeof readSvg !== 'function') fail('readSvg callback is required');
  const names = new Set();
  const codepoints = new Set();
  for (let i = 0; i < metadata.length; i += 1) {
    const entry = metadataEntry(metadata[i], i);
    if (names.has(entry.name)) fail(`duplicate canonical name ${entry.name}`);
    if (codepoints.has(entry.codepoint)) fail(`duplicate codepoint ${entry.codepoint}`);
    names.add(entry.name);
    codepoints.add(entry.codepoint);
  }
  const records = [];
  const exclusions = [];
  const excludedNames = new Set();
  const excludedAliases = new Set();
  for (const entry of metadata) if (isBrand(entry)) {
    excludedNames.add(entry.name);
    for (const alias of entry.aliases) excludedAliases.add(alias);
  }
  for (const entry of metadata) {
    if (isBrand(entry)) {
      exclusions.push({ name: entry.name, aliases: sortedUnique(entry.aliases, 256, `${entry.name} excluded aliases`), reason: 'Brand / Logo' });
      continue;
    }
    const svgPath = `svg/${entry.name}.svg`;
    const svg = await readSvg(svgPath);
    const geometry = parseSvg(svg, entry.name);
    // Editor matching case-folds terms. Apply the same boundary to tags, while
    // retaining an included canonical name even if a brand used it as an alias.
    const allowedTerm = term => !excludedNames.has(term.toLowerCase()) && !excludedAliases.has(term.toLowerCase());
    const aliases = sortedUnique(entry.aliases.filter(allowedTerm), MAX_ALIASES, `${entry.name} aliases`);
    const searchTags = sortedUnique(entry.tags.filter(allowedTerm), 64, `${entry.name} tags`);
    const label = entry.name.split('-').map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
    records.push({
      name: entry.name,
      label,
      codepoint: entry.codepoint,
      width: geometry.width,
      height: geometry.height,
      paths: geometry.paths,
      aliases,
      tags: searchTags,
      searchTerms: sortedUnique([entry.name, ...aliases, ...searchTags], MAX_SEARCH_TERMS, `${entry.name} search terms`),
      deprecated: entry.deprecated === true,
      source: { package: MDI_PACKAGE, version: MDI_VERSION, metadataPath: 'meta.json', svgPath }
    });
  }
  records.sort(compareNames);
  exclusions.sort(compareNames);
  const counts = { metadata: metadata.length, included: records.length, excluded: exclusions.length };
  const source = { package: MDI_PACKAGE, version: MDI_VERSION };
  const exclusionNames = exclusions.map(item => item.name).sort();
  const reasons = { 'Brand / Logo': exclusions.length };
  return {
    records,
    source,
    counts,
    exclusions: { count: exclusions.length, reasons, names: exclusionNames, entries: exclusions },
    report: { source, counts, exclusions: { count: exclusions.length, names: exclusionNames, reasons } }
  };
}

/** Read the installed, lock-pinned package and return validated neutral records. */
export async function loadPinnedMdiMetadata({ root = process.cwd() } = {}) {
  const packageRoot = resolve(root, 'node_modules/@mdi/svg');
  const packageInfo = JSON.parse(await readBoundedText(resolve(packageRoot, 'package.json'), MAX_PACKAGE_BYTES));
  if (packageInfo.name !== MDI_PACKAGE || packageInfo.version !== MDI_VERSION) fail(`installed package must be exactly ${MDI_VERSION}`);
  const projectPackage = JSON.parse(await readBoundedText(resolve(root, 'package.json'), MAX_PACKAGE_BYTES));
  if (projectPackage.dependencies?.[MDI_PACKAGE] !== MDI_VERSION) fail(`package.json must pin exactly ${MDI_VERSION} as a production dependency`);
  const lock = JSON.parse(await readBoundedText(resolve(root, 'package-lock.json'), MAX_LOCK_BYTES));
  const locked = lock.packages?.['node_modules/@mdi/svg'];
  if (lock.lockfileVersion !== 3 || locked?.version !== MDI_VERSION) fail(`package-lock.json must pin exactly ${MDI_VERSION}`);
  const metadata = JSON.parse(await readBoundedText(resolve(packageRoot, 'meta.json'), MAX_METADATA_BYTES));
  const result = await normalizeMdiMetadata({
    metadata,
    readSvg: path => readBoundedText(resolve(packageRoot, path), MAX_SVG_BYTES)
  });
  if (result.counts.metadata !== 7447 || result.counts.included !== 7205 || result.counts.excluded !== 242) {
    fail('metadata counts differ from the approved 7.4.47 source catalogue');
  }
  return result;
}
