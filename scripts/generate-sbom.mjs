import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDependencyEvidence } from './dependency-evidence.mjs';
export async function main({ projectRoot = process.cwd(), outputDir = resolve(projectRoot, 'build/dependency-evidence') } = {}) {
  const evidence = await generateDependencyEvidence({ projectRoot, outputDir }); await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'SBOM.cdx.json'), evidence.files.sbom); return evidence.sbom;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
