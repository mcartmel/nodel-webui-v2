export const ICON_ARTIFACT_SCHEMA_VERSION = 1;
export const ICON_ARTIFACT_PROFILES = ['free', 'pro-local'] as const;
export const MAX_ICON_SHARD_RECORDS = 4096;
export const MAX_ICON_INDEX_BYTES = 256 * 1024;
export type IconArtifactProfile = typeof ICON_ARTIFACT_PROFILES[number];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]) => isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const safeName = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const safeText = (value: unknown, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && ![...value].some(char => { const code = char.charCodeAt(0); return code < 32 || code === 127; });
const sortedUnique = (value: unknown, max: number) => Array.isArray(value) && value.length <= max && value.every(item => safeText(item, 128)) && value.every((item, index) => index === 0 || (typeof value[index - 1] === 'string' && typeof item === 'string' && value[index - 1] < item));
const safeLigature = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0x10ffff) || safeText(value, 128);
const compareLigatures = (left: unknown, right: unknown) => typeof left === typeof right ? (String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0) : typeof left === 'number' ? -1 : 1;
const sortedUniqueLigatures = (value: unknown) => Array.isArray(value) && value.length <= 32 && value.every(safeLigature) && value.every((item, index) => index === 0 || compareLigatures(value[index - 1], item) < 0);
const prereleaseIdentifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const buildIdentifier = '[0-9A-Za-z-]+';
const semverExpression = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(?:${prereleaseIdentifier})(?:\\.(?:${prereleaseIdentifier}))*)?(?:\\+(?:${buildIdentifier})(?:\\.(?:${buildIdentifier}))*)?$`);

export const isExactSemVer = (value: unknown): value is string => typeof value === 'string' && semverExpression.test(value);
export const semVerMajor = (value: unknown) => isExactSemVer(value) ? value.split('.', 1)[0] : null;

export function validateIconArtifact(value: unknown, expectedProfile?: IconArtifactProfile): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Icon artifact index schema or profile is invalid');
  if (!exactKeys(value, ['schemaVersion', 'profile', 'packageVersion', 'sources', 'default', 'aliases', 'families', 'cataloguePath']) || value.schemaVersion !== ICON_ARTIFACT_SCHEMA_VERSION || !ICON_ARTIFACT_PROFILES.includes(value.profile as IconArtifactProfile) || (expectedProfile && value.profile !== expectedProfile)) throw new Error('Icon artifact index schema or profile is invalid');
  if (!isExactSemVer(value.packageVersion) || !Array.isArray(value.sources) || value.sources.length === 0 || !isRecord(value.default) || !exactKeys(value.default, ['family', 'style']) || !safeName(value.default.family) || !safeName(value.default.style) || !isRecord(value.aliases) || !Array.isArray(value.families) || typeof value.cataloguePath !== 'string') throw new Error('Icon artifact index shape is invalid');
  let sourceMajor: string | undefined;
  let previousSource = '';
  const sources = value.sources as unknown[];
  for (const sourceValue of sources) {
    if (!isRecord(sourceValue)) throw new Error('Icon source record is invalid or unsorted');
    const sourcePackage = sourceValue.package;
    const sourceVersion = sourceValue.version;
    if (!exactKeys(sourceValue, ['package', 'version']) || typeof sourcePackage !== 'string' || !/^@fortawesome\/[a-z0-9-]+$/.test(sourcePackage) || !isExactSemVer(sourceVersion) || sourcePackage <= previousSource) throw new Error('Icon source record is invalid or unsorted');
    const major = sourceVersion.split('.', 1)[0]!;
    if (sourceMajor !== undefined && sourceMajor !== major) throw new Error('Icon source packages must use the same Font Awesome major');
    sourceMajor = major; previousSource = sourcePackage;
  }
  if (!/^v2\/icons\/catalogue-[0-9a-f]{16}\.json$/.test(value.cataloguePath)) throw new Error('Icon catalogue path is unsafe or has an invalid digest');
  const paths = new Set<string>();
  const familyNames = new Set<string>();
  const families = value.families as unknown[];
  for (const family of families) {
    if (!isRecord(family)) throw new Error('Icon family entry is invalid');
    const familyName = family.family;
    const familyDefaultStyle = family.defaultStyle;
    const familyStyles = family.styles;
    if (!exactKeys(family, ['family', 'defaultStyle', 'styles']) || !safeName(familyName) || !safeName(familyDefaultStyle) || !Array.isArray(familyStyles) || familyNames.has(familyName as string)) throw new Error('Icon family entry is invalid or duplicated');
    familyNames.add(familyName as string);
    const styleNames = new Set<string>();
    for (const style of familyStyles as unknown[]) {
      if (!isRecord(style)) throw new Error('Icon style entry is invalid');
      const styleName = style.style;
      const sharding = isRecord(style) && isRecord(style.sharding) ? style.sharding : null;
      const bucketCount = sharding?.bucketCount;
      const shardPaths = isRecord(style) && Array.isArray(style.shards) ? style.shards : [];
      if (!exactKeys(style, ['style', 'sharding', 'shards']) || !safeName(styleName) || styleNames.has(styleName as string) || !sharding || !exactKeys(sharding, ['algorithm', 'bucketCount', 'maxBytes']) || sharding.algorithm !== 'fnv1a-32' || typeof bucketCount !== 'number' || !Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 128 || (bucketCount & (bucketCount - 1)) !== 0 || sharding.maxBytes !== 128 * 1024 || shardPaths.length !== bucketCount || shardPaths.some(path => typeof path !== 'string')) throw new Error('Icon style sharding metadata is invalid');
      styleNames.add(styleName as string);
       for (const [bucket, path] of (shardPaths as string[]).entries()) {
         const match = path.match(/^v2\/icons\/([a-z0-9-]+)-([a-z0-9-]+)-(\d+)-([0-9a-f]{12})\.json$/);
         if (!match || match[1] !== familyName || match[2] !== styleName || Number(match[3]) !== bucket || paths.has(path)) throw new Error('Icon shard path is unsafe, reordered, or duplicated');
         paths.add(path);
       }
    }
    if (!styleNames.has(familyDefaultStyle as string)) throw new Error('Icon family default style is undeclared');
  }
  const defaultEntry = value.default;
  const defaultFamily = defaultEntry.family as string;
  const defaultStyle = defaultEntry.style as string;
  const matchingFamily = families.find(family => isRecord(family) && family.family === defaultFamily);
  if (!familyNames.has(defaultFamily) || !isRecord(matchingFamily) || !Array.isArray(matchingFamily.styles) || !matchingFamily.styles.some((style: unknown) => isRecord(style) && style.style === defaultStyle)) throw new Error('Icon artifact default family/style is undeclared');
  for (const [alias, canonical] of Object.entries(value.aliases)) if (!safeName(alias) || !safeName(canonical)) throw new Error('Icon alias is invalid');
}

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

export function validateIconShard(value: unknown, expected: { profile: string; family: string; style: string; bucket: number }): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Icon shard envelope is invalid');
  if (!exactKeys(value, ['schemaVersion', 'profile', 'family', 'style', 'bucket', 'records']) || value.schemaVersion !== ICON_ARTIFACT_SCHEMA_VERSION || !ICON_ARTIFACT_PROFILES.includes(value.profile as IconArtifactProfile) || value.profile !== expected.profile || !safeName(value.family) || value.family !== expected.family || !safeName(value.style) || value.style !== expected.style || typeof value.bucket !== 'number' || !Number.isInteger(value.bucket) || value.bucket < 0 || value.bucket >= 128 || value.bucket !== expected.bucket || !Array.isArray(value.records) || value.records.length > MAX_ICON_SHARD_RECORDS) throw new Error('Icon shard envelope is invalid');
  let previous = '';
  for (const recordValue of value.records as unknown[]) {
    const record = recordValue;
    if (!isRecord(record)) throw new Error('Icon shard record is invalid');
    const recordName = record.name;
    const width = isRecord(record) ? record.width : undefined;
    const height = isRecord(record) ? record.height : undefined;
    const ligatures = Array.isArray(record.ligatures) ? record.ligatures as unknown[] : [];
    const paths = Array.isArray(record.paths) ? record.paths as unknown[] : [];
    if (!exactKeys(record, ['name', 'width', 'height', 'unicode', 'ligatures', 'paths']) || typeof recordName !== 'string' || !safeName(recordName) || recordName <= previous || typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 4096 || typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > 4096 || typeof record.unicode !== 'string' || !/^[0-9a-f]{1,8}$/.test(record.unicode) || !sortedUniqueLigatures(ligatures) || !Array.isArray(record.paths) || (paths.length !== 1 && paths.length !== 2) || paths.some(path => !safeText(path, 262144))) throw new Error('Icon shard record is invalid');
    previous = recordName;
  }
}

export function validateIconCatalogue(value: unknown, expectedProfile: IconArtifactProfile, index?: Record<string, unknown>): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Icon catalogue is invalid');
  if (!exactKeys(value, ['schemaVersion', 'profile', 'records']) || value.schemaVersion !== ICON_ARTIFACT_SCHEMA_VERSION || value.profile !== expectedProfile || !Array.isArray(value.records) || value.records.length > 100000) throw new Error('Icon catalogue is invalid');
  let previous = '';
  const keys = new Set<string>();
  for (const recordValue of value.records as unknown[]) {
    const record = recordValue;
    if (!isRecord(record)) throw new Error('Icon catalogue record is invalid');
    const name = record.name; const family = record.family; const style = record.style;
    if (!exactKeys(record, ['aliases', 'officialAliases', 'family', 'label', 'name', 'style', 'terms']) || typeof name !== 'string' || !safeName(name) || typeof family !== 'string' || !safeName(family) || typeof style !== 'string' || !safeName(style) || `${name}\0${family}\0${style}` <= previous || !safeText(record.label) || !sortedUnique(record.terms, 128) || !sortedUnique(record.aliases, 128) || !sortedUnique(record.officialAliases, 32)) throw new Error('Icon catalogue record is invalid');
    previous = `${name}\0${family}\0${style}`;
    keys.add(previous);
  }
  if (index !== undefined) {
    validateIconArtifact(index, expectedProfile);
    const typedIndex = index as { families: unknown[]; aliases: Record<string, unknown>; default: Record<string, unknown> };
    const declarations = new Set<string>();
    for (const family of typedIndex.families) if (isRecord(family) && typeof family.family === 'string' && Array.isArray(family.styles)) for (const style of family.styles as unknown[]) if (isRecord(style) && typeof style.style === 'string') declarations.add(`${family.family}\0${style.style}`);
    if ((value.records as unknown[]).some(record => isRecord(record) && typeof record.family === 'string' && typeof record.style === 'string' && !declarations.has(`${record.family}\0${record.style}`))) throw new Error('Icon catalogue references an undeclared family/style');
    const defaultFamily = typedIndex.default.family; const defaultStyle = typedIndex.default.style;
    if (typeof defaultFamily !== 'string' || typeof defaultStyle !== 'string') throw new Error('Icon artifact defaults are invalid');
    for (const canonical of Object.values(typedIndex.aliases)) if (typeof canonical !== 'string' || !keys.has(`${canonical}\0${defaultFamily}\0${defaultStyle}`)) throw new Error('Icon alias target is absent from the catalogue');
  }
}
