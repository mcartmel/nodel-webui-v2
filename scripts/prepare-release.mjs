import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReleaseReport, parseReleaseArgs, prepareRelease } from './release-contract.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parsePrepareReleaseArgs(argv) {
  return parseReleaseArgs(argv, { projectRoot });
}

async function main() {
  const options = parsePrepareReleaseArgs(process.argv.slice(2));
  const report = await prepareRelease(options, { projectRoot });
  if (!options.quiet) {
    console.log(options.json ? JSON.stringify(report) : formatReleaseReport(report));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
