export function generateIconArtifacts(input: unknown): { index: Record<string, unknown>; catalogue: string; files: Map<string, Buffer>; report: Record<string, unknown> };
export type IconLibrary = 'fontawesome' | 'mdi';
export interface IconSource { library: IconLibrary; package: string; version: string }
export interface NormalizedIconRecord {
  name: string; width: number; height: number; unicode: string;
  ligatures: Array<string | number>; paths: string[]; label: string;
  terms: string[]; aliases: string[]; officialAliases: string[];
}
export function normalizeIconRecord(value: unknown): NormalizedIconRecord;
export function normalizeNeutralIconRecord(value: unknown): NormalizedIconRecord;
export function adaptMdiIconRecord(value: unknown): NormalizedIconRecord;
export function validateIconSources(value: unknown, options?: { publicOnly?: boolean }): void;
export const iconArtifactSchemaVersion: 2;
export const publicIconSources: readonly string[];
export const maxIconShardBytes: number;
export const maxIconShardRecords: number;
export const maxIconCatalogueBytes: number;
export function validateIconArtifact(value: unknown, options?: { expectedProfile?: string }): true;
export function validateIconShard(value: unknown, options?: { profile?: string; family?: string; style?: string; bucket?: number }): true;
export function validateIconCatalogue(value: unknown, options?: { expectedProfile?: string; index?: Record<string, unknown> }): true;
export function validateIconArtifactFiles(indexBytes: Buffer, files: Map<string, Buffer>, options?: { expectedProfile?: string; expectedPackageVersion?: string }): { index: Record<string, unknown>; paths: Set<string> };
export function fnv1a32(value: string): number;
export function isExactSemVer(value: unknown): boolean;
export function semVerMajor(value: unknown): string | null;
export const maxIconIndexBytes: number;
