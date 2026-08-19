import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateDependencyEvidence } from './dependency-evidence.mjs';
import { verifyAudit } from './verify-audit.mjs';
import { verifyPublicRelease } from './verify-public-release.mjs';
export async function verifyDependencies(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd(); const outputDir = options.outputDir ?? resolve(projectRoot, 'build/dependency-evidence');
  const evidence = await generateDependencyEvidence({ ...options, projectRoot, outputDir }); await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'SBOM.cdx.json'), evidence.files.sbom); await writeFile(resolve(outputDir, 'THIRD-PARTY-LICENSES.json'), evidence.files.licenses);
   const audit = await verifyAudit({ projectRoot, outputDir, exceptionsPath: options.exceptionsPath }); const publicRelease = await verifyPublicRelease({ projectRoot }); return { lockHash: evidence.lockHash, sbom: evidence.sbom, licenses: evidence.licenses, audit, publicRelease };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyDependencies().then(report => console.log(JSON.stringify(report))).catch(error => { console.error(error.message); process.exitCode = 1; });
