import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictArgs } from './deployment-contract.mjs';
import { verifyReleaseBundle } from './release-contract.mjs';

export function parseVerifyReleaseBundleArgs(argv) {
  return parseStrictArgs(argv, {
    target: { required: true },
    json: { type: 'boolean', default: false }
  });
}

export async function runVerifyReleaseBundle(options) {
  const target = resolve(options.target);
  const manifest = await verifyReleaseBundle(target);
  return { target, schemaVersion: manifest.schemaVersion, version: manifest.version, commit: manifest.commit, publishable: manifest.source.publishable };
}

async function main() {
  const options = parseVerifyReleaseBundleArgs(process.argv.slice(2));
  const report = await runVerifyReleaseBundle(options);
  console.log(options.json ? JSON.stringify(report) : `Verified release bundle ${report.version} at ${report.target}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
