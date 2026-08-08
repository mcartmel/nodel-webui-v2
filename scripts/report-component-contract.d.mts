export function canonicalizeContract(value: unknown): unknown;
export function semanticContractHash(value: unknown): string;
export function canonicalDiff(before: unknown, after: unknown): Promise<{ breaking: string[]; additive: string[]; informational: string[]; operational: string[] }>;
export function reportComponentContract(options?: { writeReport?: boolean }): Promise<unknown>;
