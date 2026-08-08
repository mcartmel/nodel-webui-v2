import { verifyBundleBudget } from './verify-bundle-budget.mjs';
try {
  const result = await verifyBundleBudget({ enforce: false });
  console.log(result.markdown);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
