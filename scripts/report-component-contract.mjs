import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { validateComponentContractArtifact } from './deployment-contract.mjs';

const root = resolve(process.cwd());
const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export function canonicalizeContract(value) {
  if (Array.isArray(value)) return value.map(canonicalizeContract);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalizeContract(value[key])]));
  return value;
}
export function semanticContractHash(value) {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  return createHash('sha256').update(JSON.stringify(canonicalizeContract(document))).digest('hex');
}

export async function canonicalDiff(before, after) {
  const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const module = await server.ssrLoadModule('/src/component-contract/diff.ts');
    return module.diffComponentContracts(before, after);
  } finally {
    await server.close();
  }
}

async function canonicalSerializedContract(packageVersion) {
  const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const module = await server.ssrLoadModule('/src/component-contract/serialize.ts');
    return module.serializeComponentContract(packageVersion);
  } finally {
    await server.close();
  }
}

export async function reportComponentContract({ writeReport = true } = {}) {
  const packageData = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const currentSource = await canonicalSerializedContract(packageData.version);
  const goldenSource = await readFile(resolve(root, 'test/fixtures/production-refinement-stage1-component-contract.json'), 'utf8');
  const current = validateComponentContractArtifact(currentSource, packageData.version);
  const golden = validateComponentContractArtifact(goldenSource, packageData.version);
  const diff = await canonicalDiff(golden, current);
  const result = {
    schemaVersion: 1,
    hashes: { golden: semanticContractHash(golden), current: semanticContractHash(current) },
    counts: Object.fromEntries(Object.entries(diff).map(([key, items]) => [key, items.length])),
    diff,
    breaking: diff.breaking.length > 0
  };
  if (writeReport) {
    await mkdir(resolve(root, 'build/contract-report'), { recursive: true });
    await writeFile(resolve(root, 'build/contract-report/contract-diff.json'), `${JSON.stringify(result, null, 2)}\n`);
    const sections = Object.entries(diff).map(([key, items]) => `## ${key} (${items.length})\n${items.map((item) => `- ${item}`).join('\n') || '- none'}`).join('\n\n');
    await writeFile(resolve(root, 'build/contract-report/contract-diff.md'), `# Component Contract Impact\n\n${sections}\n`);
  }
  return result;
}

if (process.argv[1]?.endsWith('report-component-contract.mjs')) reportComponentContract().catch((error) => { console.error(error.message); process.exitCode = 1; });
