export interface MdiMetadataRecord {
  name: string;
  label: string;
  codepoint: string;
  width: number;
  height: number;
  paths: string[];
  /** Sorted, unique search-only aliases; at most 32 (artifact officialAliases limit). */
  aliases: string[];
  /** Sorted, unique non-brand category terms; at most 64. */
  tags: string[];
  /** Sorted, unique search terms; at most 128, each at most 128 characters. */
  searchTerms: string[];
  deprecated: boolean;
  source: { package: '@mdi/svg'; version: '7.4.47'; metadataPath: 'meta.json'; svgPath: string };
}
export interface MdiMetadataResult {
  records: MdiMetadataRecord[];
  source: { package: '@mdi/svg'; version: '7.4.47' };
  counts: { metadata: number; included: number; excluded: number };
  exclusions: { count: number; reasons: Record<string, number>; names: string[]; entries: Array<{ name: string; aliases: string[]; reason: 'Brand / Logo' }> };
  /** In-memory generation evidence only. Report persistence is deferred to stage 2. */
  report: {
    source: { package: '@mdi/svg'; version: '7.4.47' };
    counts: { metadata: number; included: number; excluded: number };
    exclusions: { count: number; names: string[]; reasons: Record<string, number> };
  };
}
export const MDI_PACKAGE: '@mdi/svg';
export const MDI_VERSION: '7.4.47';
export function normalizeMdiMetadata(options: { metadata: unknown[]; readSvg: (path: string) => Promise<string> | string }): Promise<MdiMetadataResult>;
export function loadPinnedMdiMetadata(options?: { root?: string }): Promise<MdiMetadataResult>;
