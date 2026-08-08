import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reportComponentContract } from './report-component-contract.mjs';
import { verifyBundleBudget } from './verify-bundle-budget.mjs';

const root = resolve(process.cwd());
async function main() {
  let contract;
  let bundle;
  let failure;
  try { contract = await reportComponentContract(); } catch (error) { failure = error; }
  try { bundle = await verifyBundleBudget({ enforce: false }); } catch (error) { failure ??= error; }
  if (contract?.breaking) failure ??= new Error(`Component contract has ${contract.counts.breaking} breaking change(s)`);
  if (bundle?.failures.length) failure ??= new Error(bundle.failures.join('; '));
  const result = { schemaVersion: 1, contract: contract ?? null, bundle: bundle ?? null, failed: Boolean(failure) };
  await mkdir(resolve(root, 'build/review-impact'), { recursive: true });
  await writeFile(resolve(root, 'build/review-impact/review-impact.json'), `${JSON.stringify(result, null, 2)}\n`);
  const contractMarkdown = contract
    ? Object.entries(contract.diff).map(([key, items]) => `### ${key} (${items.length})\n${items.map((item) => `- ${item}`).join('\n') || '- none'}`).join('\n\n')
    : 'unavailable';
  const summary = `# Review Impact\n\n## Component API\n${contract ? `breaking ${contract.counts.breaking}, additive ${contract.counts.additive}, informational ${contract.counts.informational}, operational ${contract.counts.operational}\n\n${contractMarkdown}` : 'unavailable'}\n\n## Bundle\n${bundle ? bundle.markdown : 'unavailable'}\n`;
  await writeFile(resolve(root, 'build/review-impact/review-impact.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  if (failure) throw new Error(failure instanceof Error ? failure.message : 'Review impact verification failed');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
