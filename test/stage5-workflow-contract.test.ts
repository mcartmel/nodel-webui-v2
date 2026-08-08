// @vitest-environment node

import { readFile } from 'node:fs/promises';

describe('Stage 5 workflow contract', () => {
  it('runs early contract reporting and preserves all review evidence on failure', async () => {
    for (const workflow of ['.github/workflows/build.yml', '.github/workflows/release.yml']) {
      const source = await readFile(workflow, 'utf8');
      expect(source).toContain('name: Report component contract impact');
      expect(source).toContain('if: always()');
      expect(source).toContain('run: npm run report:component-contract');
      expect(source).toContain('name: Verify review impact');
      expect(source).toContain('run: npm run report:bundle-budget');
      expect(source).toContain('name: review-impact');
      expect(source).toContain('build/contract-report/');
      expect(source).toContain('build/bundle-budget.json');
      expect(source).toContain('build/review-impact/');
      expect(source).toContain('build/bundle-graph.json');
      expect(source.indexOf('name: Lint')).toBeLessThan(source.indexOf('name: Build preview'));
      expect(source.indexOf('name: Build preview')).toBeLessThan(source.indexOf('name: Report bundle budget'));
      expect(source.indexOf('name: Report bundle budget')).toBeLessThan(source.indexOf('name: Run full per-file coverage tests'));
      expect(source.indexOf('name: Run full per-file coverage tests')).toBeLessThan(source.indexOf('name: Verify review impact'));
    }
  });

  it('keeps graph and report artifacts outside deployable dist', async () => {
    const source = await readFile('scripts/bundle-graph.mjs', 'utf8');
    expect(source).toContain("resolve(projectRoot, 'build')");
    expect(source).not.toContain("resolve(projectRoot, 'dist/.vite')");
  });

});
