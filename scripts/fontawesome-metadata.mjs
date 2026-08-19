import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const freeFontAwesomeMetadataPackage = '@fortawesome/fontawesome-free';
const maxMetadataBytes = 32 * 1024 * 1024;
function hasDisallowedControl(value) {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127;
  });
}

function ownRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function yamlLineWithoutComment(line) {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === "'" && character === "'" && line[index + 1] === "'") { index += 1; continue; }
    if (character === quote) quote = '';
    else if (!quote && (character === "'" || character === '"') && (index === 0 || /[\s:]/.test(line[index - 1]))) quote = character;
    else if (!quote && character === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  if (quote) throw new Error('Font Awesome metadata has an unterminated quoted scalar');
  return line;
}

function yamlScalar(value) {
  const text = value.trim();
  if (!text || hasDisallowedControl(text) || /^(?:!|&|\*)/.test(text)) throw new Error('Font Awesome metadata contains an unsupported YAML scalar');
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (/^(?:null|~)$/i.test(text)) return null;
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)$/.test(text)) return Number(text);
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { throw new Error('Font Awesome metadata contains an invalid quoted scalar'); }
  }
  if (/^'(?:[^']|'')*'$/.test(text)) return text.slice(1, -1).replaceAll("''", "'");
  // FA metadata legitimately uses punctuation, URLs, Unicode, and apostrophes in plain scalars.
  if (/^[\s\S]+$/.test(text)) return text;
  throw new Error('Font Awesome metadata contains an unsupported YAML scalar');
}

export function parseFontAwesomeMetadataYaml(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > maxMetadataBytes || hasDisallowedControl(source) || /\t/.test(source)) throw new Error('Font Awesome metadata is too large or contains unsupported controls');
  const lines = source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n').map((raw, number) => {
    const line = yamlLineWithoutComment(raw).replace(/\s+$/, '');
    if (!line || /^(?:---|\.\.\.|%YAML\b)/.test(line)) return null;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent % 2) throw new Error(`Font Awesome metadata has invalid indentation on line ${number + 1}`);
    return { indent, text: line.slice(indent), number: number + 1 };
  }).filter(Boolean);
  let cursor = 0;
  function block(indent) {
    const first = lines[cursor];
    if (!first || first.indent !== indent) throw new Error('Font Awesome metadata has an invalid block');
    const list = first.text.startsWith('- ');
    const result = list ? [] : {};
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const current = lines[cursor];
      if (list) {
        if (!current.text.startsWith('- ')) throw new Error(`Font Awesome metadata mixes collections on line ${current.number}`);
        const value = current.text.slice(2).trim();
        if (!value) throw new Error(`Font Awesome metadata has an empty list item on line ${current.number}`);
        result.push(yamlScalar(value));
        cursor += 1;
        continue;
      }
      if (current.text.startsWith('- ')) throw new Error(`Font Awesome metadata mixes collections on line ${current.number}`);
      const match = current.text.match(/^(?:"([^"\\]+)"|'([^']+)'|([^:\s][^:]*?)):\s*(.*)$/);
      if (!match) throw new Error(`Font Awesome metadata has an invalid mapping on line ${current.number}`);
      const key = (match[1] ?? match[2] ?? match[3]).trim();
      const value = match[4];
      if (!key || hasDisallowedControl(key) || Object.hasOwn(result, key)) throw new Error(`Font Awesome metadata has an invalid key on line ${current.number}`);
      cursor += 1;
      if (value) result[key] = yamlScalar(value);
      else if (lines[cursor]?.indent === indent + 2) result[key] = block(indent + 2);
      else throw new Error(`Font Awesome metadata has an empty mapping on line ${current.number}`);
    }
    return result;
  }
  if (!lines.length) throw new Error('Font Awesome metadata is empty');
  const document = block(0);
  if (cursor !== lines.length || !ownRecord(document)) throw new Error('Font Awesome metadata has an invalid document');
  return document;
}

export function metadataForFontAwesomeIcon(metadata, name) {
  const entry = metadata?.[name];
  if (!ownRecord(entry) || typeof entry.label !== 'string' || !entry.label || !ownRecord(entry.search)
    || !Array.isArray(entry.search.terms) || entry.search.terms.some(term => typeof term !== 'string')) {
    throw new Error(`Missing Font Awesome metadata for ${name}`);
  }
  return { label: entry.label, searchTerms: entry.search.terms };
}

export function enrichFontAwesomeIcons(icons, metadata) {
  if (!Array.isArray(icons)) throw new Error('Font Awesome icon definitions are invalid');
  return icons.map(icon => {
    if (!icon || typeof icon !== 'object' || typeof icon.iconName !== 'string') throw new Error('Font Awesome icon definition has no canonical name');
    return { ...icon, ...metadataForFontAwesomeIcon(metadata, icon.iconName) };
  });
}

export async function loadPinnedFreeFontAwesomeMetadata(root = process.cwd()) {
  const projectRoot = resolve(root);
  const lock = JSON.parse(await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8'));
  const version = lock?.packages?.[`node_modules/${freeFontAwesomeMetadataPackage}`]?.version;
  if (typeof version !== 'string' || !version) throw new Error('Pinned Font Awesome Free metadata package version is missing');
  const source = await readFile(resolve(projectRoot, 'node_modules', freeFontAwesomeMetadataPackage, 'metadata/icons.yml'), 'utf8');
  return { package: freeFontAwesomeMetadataPackage, version, metadata: parseFontAwesomeMetadataYaml(source) };
}
