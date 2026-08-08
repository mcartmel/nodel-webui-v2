import { verifyBundleBudget } from './verify-bundle-budget.mjs';
import { readFile } from 'node:fs/promises';
try {
  const result = await verifyBundleBudget();
  console.log(result.markdown);
} catch (error) {
  try { console.error(await readFile('build/bundle-budget.md', 'utf8')); } catch { /* preserve the verifier error when no report exists */ }
  console.error(error.message);
  process.exitCode = 1;
}
