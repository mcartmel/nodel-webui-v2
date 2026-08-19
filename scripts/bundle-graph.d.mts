export function normalizeOutputPath(value: string): string;
export function normalizeRollupBundle(bundle: Record<string, unknown>, projectRoot: string): unknown;
export function finalizeBundleGraph(graph: { outputs: Array<{ path: string }> }, presentPaths: Iterable<string>, expectedPaths?: string[]): unknown;
export function writeBundleGraph(graph: unknown, reportPath?: string): Promise<void>;
export function bundleGraphPlugin(projectRoot: string, outputRoot?: string, reportPath?: string): {
  name: string;
  generateBundle: (_options: unknown, bundle: Record<string, unknown>) => void;
  writeBundle: () => Promise<void>;
};
