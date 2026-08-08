import { reportComponentContract } from './report-component-contract.mjs';
try {
  const result = await reportComponentContract();
  console.log(`Component contract impact: breaking ${result.counts.breaking}, additive ${result.counts.additive}, informational ${result.counts.informational}, operational ${result.counts.operational}`);
  console.log('Report: build/contract-report/contract-diff.md');
} catch (error) { console.error(error.message); process.exitCode = 1; }
