export function measureFiles(paths: string[], read?: (path: string) => Promise<Buffer>): Promise<{ files: string[]; raw: number; gzip: number }>;
export function traverseBundleGraph(graph: { outputs: Array<Record<string, unknown>> }, start: string, edge?: string, seen?: Set<string>): Set<string>;
export function validatePolicy(policy: unknown): void;
export function validateReleaseNotes(releaseNotes: string, policy: { releaseNotesMarker: string; rationale: string }): void;
export function metric(name: string, actual: { raw: number; gzip: number; files?: string[] }, budget: { rawBaseline: number; rawMax: number; gzipBaseline: number; gzipMax: number }): unknown;
export function formatReportLine(item: unknown): string;
export function verifyBundleBudget(options?: { projectRoot?: string; distDir?: string; graph?: unknown; policy?: unknown; releaseNotes?: string; graphPath?: string; policyPath?: string; releaseNotesPath?: string; reportDir?: string; writeReport?: boolean; enforce?: boolean }): Promise<unknown>;
