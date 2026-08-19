import { createHash } from 'node:crypto';

export const iconArtifactSchemaVersion = 1;
export const iconArtifactProfile = 'free';
export const maxIconShardBytes = 128 * 1024;
export const maxIconIndexBytes = 256 * 1024;
export const maxIconShardRecords = 4096;
export const maxIconCatalogueBytes = 16 * 1024 * 1024;
export const publicIconSources = Object.freeze([
  '@fortawesome/fontawesome-free',
  '@fortawesome/free-brands-svg-icons',
  '@fortawesome/free-regular-svg-icons',
  '@fortawesome/free-solid-svg-icons'
]);

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = value => createHash('sha256').update(value).digest('hex');
const exactKeys = (value, keys) => isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const safeName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const safeText = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && ![...value].some(char => { const code = char.charCodeAt(0); return code < 32 || code === 127; });
const prereleaseIdentifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const buildIdentifier = '[0-9A-Za-z-]+';
const semverExpression = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(?:${prereleaseIdentifier})(?:\\.(?:${prereleaseIdentifier}))*)?(?:\\+(?:${buildIdentifier})(?:\\.(?:${buildIdentifier}))*)?$`);
export const isExactSemVer = value => typeof value === 'string' && semverExpression.test(value);
export const semVerMajor = value => isExactSemVer(value) ? value.split('.', 1)[0] : null;
const sortedUnique = (value, max) => Array.isArray(value) && value.length <= max && value.every(item => safeText(item, 128)) && value.every((item, index) => index === 0 || compare(value[index - 1], item) < 0);
const safeLigature = value => (Number.isInteger(value) && value >= 0 && value <= 0x10ffff) || safeText(value, 128);
const compareLigatures = (left, right) => typeof left === typeof right ? compare(String(left), String(right)) : typeof left === 'number' ? -1 : 1;
const sortedUniqueLigatures = value => Array.isArray(value) && value.length <= 32 && value.every(safeLigature) && value.every((item, index) => index === 0 || compareLigatures(value[index - 1], item) < 0);
const displayLabel = value => value.split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');

export function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function normalizeIconRecord(value) {
  if (!isRecord(value) || typeof value.iconName !== 'string' || !value.iconName.trim()) throw new Error('Icon definition has no canonical iconName');
  if (!safeName(value.iconName.trim())) throw new Error(`Malformed icon name: ${value.iconName}`);
  const tuple = value.icon;
  if (!Array.isArray(tuple) || tuple.length !== 5 || !Number.isInteger(tuple[0]) || !Number.isInteger(tuple[1]) || tuple[0] < 1 || tuple[0] > 4096 || tuple[1] < 1 || tuple[1] > 4096 || !Array.isArray(tuple[2]) || typeof tuple[3] !== 'string' || !/^[0-9a-f]{1,8}$/i.test(tuple[3])) throw new Error(`Malformed icon definition: ${value.iconName}`);
  const paths = Array.isArray(tuple[4]) ? tuple[4] : [tuple[4]];
  if ((paths.length !== 1 && paths.length !== 2) || paths.some(path => !safeText(path, 262144))) throw new Error(`Malformed icon paths: ${value.iconName}`);
  if ('label' in value && !safeText(value.label, 256)) throw new Error(`Malformed icon label: ${value.iconName}`);
  if ('searchTerms' in value && (!Array.isArray(value.searchTerms) || value.searchTerms.some(term => !safeText(term, 128)))) throw new Error(`Malformed icon search terms: ${value.iconName}`);
  if ('aliases' in value && (!Array.isArray(value.aliases) || value.aliases.some(alias => !safeText(alias, 128)))) throw new Error(`Malformed icon aliases: ${value.iconName}`);
  const ligatures = [...new Set(tuple[2])].sort(compareLigatures);
  if (!sortedUniqueLigatures(ligatures)) throw new Error(`Malformed icon aliases: ${value.iconName}`);
  const officialAliases = ligatures.filter(item => typeof item === 'string');
  return {
    name: value.iconName.trim(), width: tuple[0], height: tuple[1], unicode: tuple[3].toLowerCase(), ligatures,
    paths, label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : displayLabel(value.iconName.trim()),
    terms: [...new Set([value.iconName, ...(value.searchTerms ?? []), ...officialAliases])].sort(compare),
    aliases: [...new Set(value.aliases ?? [])].sort(compare), officialAliases
  };
}

function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('Icon artifact requires source package records');
  let major;
  let previous = '';
  for (const source of sources) {
    if (!exactKeys(source, ['package', 'version']) || typeof source.package !== 'string' || !/^@fortawesome\/[a-z0-9-]+$/.test(source.package) || !isExactSemVer(source.version) || source.package <= previous) throw new Error('Icon source record is invalid or unsorted');
    const sourceMajor = source.version.split('.', 1)[0];
    if (major !== undefined && sourceMajor !== major) throw new Error('Icon source packages must use the same Font Awesome major');
    major = sourceMajor;
    previous = source.package;
  }
}

function shardBytes(profile, family, style, bucket, records) {
  return Buffer.from(json({ schemaVersion: iconArtifactSchemaVersion, profile, family, style, bucket, records }));
}

function makeShards(profile, family, style, records) {
  let bucketCount = 1;
  let buckets;
  do {
    buckets = Array.from({ length: bucketCount }, () => []);
    for (const record of records) buckets[fnv1a32(record.name) & (bucketCount - 1)].push({ name: record.name, width: record.width, height: record.height, unicode: record.unicode, ligatures: record.ligatures, paths: record.paths });
    if (buckets.some((bucket, bucketNumber) => shardBytes(profile, family, style, bucketNumber, bucket).length > maxIconShardBytes)) {
      if (bucketCount >= 128) throw new Error(`Icon shard cannot fit within ${maxIconShardBytes} bytes: ${family}/${style}`);
      bucketCount *= 2;
    }
  } while (buckets.some((bucket, bucketNumber) => shardBytes(profile, family, style, bucketNumber, bucket).length > maxIconShardBytes));
  const shards = buckets.map((bucket, bucketNumber) => {
    bucket.sort((a, b) => compare(a.name, b.name));
    const bytes = shardBytes(profile, family, style, bucketNumber, bucket);
    const path = `v2/icons/${family}-${style}-${bucketNumber}-${digest(bytes).slice(0, 12)}.json`;
    return { path, bucket: bucketNumber, bytes, records: bucket };
  });
  return { bucketCount, shards };
}

export function validateIconArtifact(value, { expectedProfile } = {}) {
  if (!exactKeys(value, ['schemaVersion', 'profile', 'packageVersion', 'sources', 'default', 'aliases', 'families', 'cataloguePath']) || value.schemaVersion !== iconArtifactSchemaVersion || !['free', 'pro-local'].includes(value.profile) || (expectedProfile && value.profile !== expectedProfile)) throw new Error('Icon artifact index schema or profile is invalid');
  if (!isExactSemVer(value.packageVersion) || !Array.isArray(value.sources) || !isRecord(value.default) || !exactKeys(value.default, ['family', 'style']) || !safeName(value.default.family) || !safeName(value.default.style) || !isRecord(value.aliases) || !Array.isArray(value.families) || typeof value.cataloguePath !== 'string') throw new Error('Icon artifact index shape is invalid');
  validateSources(value.sources);
  if (!/^v2\/icons\/catalogue-[0-9a-f]{16}\.json$/.test(value.cataloguePath)) throw new Error('Icon catalogue path is unsafe or has an invalid digest');
  const paths = new Set();
  const familyNames = new Set();
  for (const family of value.families) {
    if (!exactKeys(family, ['family', 'defaultStyle', 'styles']) || !safeName(family.family) || !safeName(family.defaultStyle) || !Array.isArray(family.styles) || familyNames.has(family.family)) throw new Error('Icon family entry is invalid or duplicated');
    familyNames.add(family.family);
    const styleNames = new Set();
    for (const style of family.styles) {
      if (!exactKeys(style, ['style', 'sharding', 'shards']) || !safeName(style.style) || styleNames.has(style.style) || !isRecord(style.sharding) || !exactKeys(style.sharding, ['algorithm', 'bucketCount', 'maxBytes']) || style.sharding.algorithm !== 'fnv1a-32' || !Number.isInteger(style.sharding.bucketCount) || style.sharding.bucketCount < 1 || style.sharding.bucketCount > 128 || (style.sharding.bucketCount & (style.sharding.bucketCount - 1)) !== 0 || style.sharding.maxBytes !== maxIconShardBytes || !Array.isArray(style.shards) || style.shards.length !== style.sharding.bucketCount) throw new Error('Icon style sharding metadata is invalid');
      styleNames.add(style.style);
      for (const [bucket, path] of style.shards.entries()) {
        const match = typeof path === 'string' ? path.match(/^v2\/icons\/([a-z0-9-]+)-([a-z0-9-]+)-(\d+)-([0-9a-f]{12})\.json$/) : null;
        if (!match || match[1] !== family.family || match[2] !== style.style || Number(match[3]) !== bucket || paths.has(path)) throw new Error('Icon shard path is unsafe, reordered, or duplicated');
        paths.add(path);
      }
    }
    if (!styleNames.has(family.defaultStyle)) throw new Error('Icon family default style is undeclared');
  }
  if (!familyNames.has(value.default.family) || !value.families.find(family => family.family === value.default.family).styles.some(style => style.style === value.default.style)) throw new Error('Icon artifact default family/style is undeclared');
  for (const [alias, canonical] of Object.entries(value.aliases)) if (!safeName(alias) || !safeName(canonical)) throw new Error('Icon alias is invalid');
  return true;
}

export function validateIconShard(value, { profile, family, style, bucket } = {}) {
  if (!exactKeys(value, ['schemaVersion', 'profile', 'family', 'style', 'bucket', 'records']) || value.schemaVersion !== iconArtifactSchemaVersion || !['free', 'pro-local'].includes(value.profile) || (profile && value.profile !== profile) || !safeName(value.family) || !safeName(value.style) || (family && value.family !== family) || (style && value.style !== style) || !Number.isInteger(value.bucket) || value.bucket < 0 || value.bucket >= 128 || (bucket !== undefined && value.bucket !== bucket) || !Array.isArray(value.records) || value.records.length > maxIconShardRecords) throw new Error('Icon shard envelope is invalid');
  let previous = '';
  for (const record of value.records) {
    if (!exactKeys(record, ['name', 'width', 'height', 'unicode', 'ligatures', 'paths']) || !safeName(record.name) || record.name <= previous || !Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width < 1 || record.width > 4096 || record.height < 1 || record.height > 4096 || typeof record.unicode !== 'string' || !/^[0-9a-f]{1,8}$/.test(record.unicode) || !sortedUniqueLigatures(record.ligatures) || !Array.isArray(record.paths) || (record.paths.length !== 1 && record.paths.length !== 2) || record.paths.some(path => !safeText(path, 262144))) throw new Error('Icon shard record is invalid');
    previous = record.name;
  }
  return true;
}

export function validateIconCatalogue(value, { expectedProfile, index } = {}) {
  if (!exactKeys(value, ['schemaVersion', 'profile', 'records']) || value.schemaVersion !== iconArtifactSchemaVersion || value.profile !== expectedProfile || !Array.isArray(value.records) || value.records.length > 100000) throw new Error('Icon catalogue is invalid');
  let previous = '';
  const keys = new Set();
  for (const record of value.records) {
    if (!exactKeys(record, ['aliases', 'officialAliases', 'family', 'label', 'name', 'style', 'terms']) || !safeName(record.name) || `${record.name}\0${record.family}\0${record.style}` <= previous || !safeName(record.family) || !safeName(record.style) || !safeText(record.label) || !sortedUnique(record.terms, 128) || !sortedUnique(record.aliases, 128) || !sortedUnique(record.officialAliases, 32)) throw new Error('Icon catalogue record is invalid');
    previous = `${record.name}\0${record.family}\0${record.style}`;
    keys.add(previous);
  }
  if (index !== undefined) {
    validateIconArtifact(index, { expectedProfile });
    const declarations = new Set(index.families.flatMap(family => family.styles.map(style => `${family.family}\0${style.style}`)));
    if (value.records.some(record => !declarations.has(`${record.family}\0${record.style}`))) throw new Error('Icon catalogue references an undeclared family/style');
    for (const canonical of Object.values(index.aliases)) if (!keys.has(`${canonical}\0${index.default.family}\0${index.default.style}`)) throw new Error('Icon alias target is absent from the catalogue');
  }
  return true;
}

export function validateIconArtifactFiles(indexBytes, files, { expectedProfile = 'free', expectedPackageVersion } = {}) {
  if (indexBytes.length > maxIconIndexBytes) throw new Error('Icon artifact index exceeds its byte limit');
  let index;
  try { index = JSON.parse(Buffer.from(indexBytes).toString('utf8')); } catch { throw new Error('Icon artifact index is not valid JSON'); }
  validateIconArtifact(index, { expectedProfile });
  if (expectedPackageVersion !== undefined && index.packageVersion !== expectedPackageVersion) throw new Error(`Icon artifact packageVersion must be ${expectedPackageVersion}`);
  const get = path => files instanceof Map ? files.get(path) : files[path];
  const catalogueBytes = get(index.cataloguePath);
  if (!catalogueBytes) throw new Error(`Icon catalogue is missing: ${index.cataloguePath}`);
  if (catalogueBytes.length > maxIconCatalogueBytes) throw new Error('Icon catalogue exceeds its byte limit');
  if (digest(catalogueBytes).slice(0, 16) !== index.cataloguePath.match(/catalogue-([0-9a-f]{16})\.json$/)?.[1]) throw new Error('Icon catalogue digest does not match its path');
  let catalogue;
  try { catalogue = JSON.parse(Buffer.from(catalogueBytes).toString('utf8')); } catch { throw new Error('Icon catalogue is not valid JSON'); }
  validateIconCatalogue(catalogue, { expectedProfile, index });
  const declared = new Set(['v2/nodel-icons.json', index.cataloguePath]);
  for (const family of index.families) for (const style of family.styles) for (const path of style.shards) {
    const bytes = get(path);
    if (!bytes) throw new Error(`Icon shard is missing: ${path}`);
    if (bytes.length > maxIconShardBytes) throw new Error(`Icon shard exceeds its byte limit: ${path}`);
    let shard;
    try { shard = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error(`Icon shard is not valid JSON: ${path}`); }
    const bucket = Number(path.match(/-(\d+)-[0-9a-f]{12}\.json$/)?.[1]);
    validateIconShard(shard, { profile: expectedProfile, family: family.family, style: style.style, bucket });
    if (shard.records.some(record => (fnv1a32(record.name) & (style.sharding.bucketCount - 1)) !== bucket)) throw new Error(`Icon shard record is in the wrong bucket: ${path}`);
    if (digest(bytes).slice(0, 12) !== path.match(/-([0-9a-f]{12})\.json$/)?.[1]) throw new Error(`Icon shard digest does not match its path: ${path}`);
    declared.add(path);
  }
  const shardKeys = new Set();
  for (const family of index.families) for (const style of family.styles) for (const path of style.shards) {
    const bytes = get(path); const shard = JSON.parse(Buffer.from(bytes).toString('utf8'));
    for (const record of shard.records) shardKeys.add(`${record.name}\0${family.family}\0${style.style}`);
  }
  const catalogueKeys = new Set(catalogue.records.map(record => `${record.name}\0${record.family}\0${record.style}`));
  for (const record of catalogue.records) if (!shardKeys.has(`${record.name}\0${record.family}\0${record.style}`)) throw new Error(`Icon catalogue record is absent from its shard: ${record.name}`);
  for (const key of shardKeys) if (!catalogueKeys.has(key)) throw new Error('Icon shard record is absent from the catalogue');
  for (const path of files instanceof Map ? files.keys() : Object.keys(files)) if (path.startsWith('v2/icons/') && !declared.has(path)) throw new Error(`Undeclared icon artifact path: ${path}`);
  if (expectedProfile === 'free') {
    const sources = index.sources.map(source => source.package).sort(compare);
    if (JSON.stringify(sources) !== JSON.stringify([...publicIconSources].sort(compare))) throw new Error('Free icon artifact declares a non-public or incomplete Font Awesome source set');
    const combinations = new Set(index.families.flatMap(family => family.styles.map(style => `${family.family}/${style.style}`)));
    if (JSON.stringify([...combinations].sort(compare)) !== JSON.stringify(['brands/brands', 'classic/regular', 'classic/solid'])) throw new Error('Free icon artifact declares unsupported family/style combinations');
  }
  return { index, paths: declared };
}

export function generateIconArtifacts({ packageVersion, profile = 'free', sources, aliases = {}, families, defaultFamily, defaultStyle }) {
  if (profile !== 'free' && profile !== 'pro-local') throw new Error(`Unsupported icon profile: ${profile}`);
  validateSources(sources);
  if (!Array.isArray(families) || !families.length) throw new Error('Icon artifact requires families');
  const shards = new Map();
  const catalogueRecords = [];
  const familyEntries = families.map(inputFamily => {
    if (!isRecord(inputFamily) || typeof inputFamily.family !== 'string' || typeof inputFamily.defaultStyle !== 'string' || !Array.isArray(inputFamily.styles)) throw new Error('Icon family adapter is invalid');
    const styles = inputFamily.styles.map(inputStyle => {
      const byName = new Map();
      for (const inputIcon of inputStyle.icons ?? []) {
        const record = normalizeIconRecord(inputIcon);
        const previous = byName.get(record.name);
        if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting icon definition: ${inputFamily.family}/${inputStyle.style}/${record.name}`);
        byName.set(record.name, record);
      }
      const records = [...byName.values()].sort((a, b) => compare(a.name, b.name));
      const built = makeShards(profile, inputFamily.family, inputStyle.style, records);
      for (const record of records) catalogueRecords.push({ name: record.name, label: record.label, terms: record.terms, aliases: record.aliases, officialAliases: record.officialAliases, family: inputFamily.family, style: inputStyle.style });
      for (const shard of built.shards) shards.set(shard.path, shard.bytes);
      return { style: inputStyle.style, sharding: { algorithm: 'fnv1a-32', bucketCount: built.bucketCount, maxBytes: maxIconShardBytes }, shards: built.shards.map(shard => shard.path) };
    }).sort((a, b) => compare(a.style, b.style));
    return { family: inputFamily.family, defaultStyle: inputFamily.defaultStyle, styles };
  }).sort((a, b) => compare(a.family, b.family));
  catalogueRecords.sort((a, b) => compare(`${a.name}\0${a.family}\0${a.style}`, `${b.name}\0${b.family}\0${b.style}`));
  const catalogue = json({ schemaVersion: iconArtifactSchemaVersion, profile, records: catalogueRecords });
  const cataloguePath = `v2/icons/catalogue-${digest(catalogue).slice(0, 16)}.json`;
  const selectedFamily = defaultFamily ?? (familyEntries.some(family => family.family === 'classic') ? 'classic' : familyEntries[0].family);
  const selectedStyle = defaultStyle ?? familyEntries.find(family => family.family === selectedFamily).defaultStyle;
  const canonicalNames = new Set(catalogueRecords.filter(record => record.family === selectedFamily && record.style === selectedStyle).map(record => record.name));
  for (const [alias, canonical] of Object.entries(aliases)) if (!safeName(alias) || !safeName(canonical) || !canonicalNames.has(canonical)) throw new Error(`Icon alias does not reference an available canonical icon: ${alias}`);
  const index = { schemaVersion: iconArtifactSchemaVersion, profile, packageVersion, sources: [...sources].sort((a, b) => compare(a.package, b.package)), default: { family: selectedFamily, style: selectedStyle }, aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => compare(a, b))), families: familyEntries, cataloguePath };
  validateIconArtifact(index, { expectedProfile: profile });
  const files = new Map([[cataloguePath, Buffer.from(catalogue)]]);
  for (const [path, bytes] of shards) files.set(path, bytes);
  const indexBytes = Buffer.from(json(index));
  files.set('v2/nodel-icons.json', indexBytes);
  return { index, catalogue, files, report: { schemaVersion: 1, profile, files: [...files.keys()].sort(compare), bytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), sourcePackages: index.sources } };
}
