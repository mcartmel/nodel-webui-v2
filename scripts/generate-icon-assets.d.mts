export function generateFreeIconAssets(options?: { outputRoot?: string }): Promise<{
  index: { sources: Array<{ package: string; version: string }> };
  catalogue: string;
}>;
