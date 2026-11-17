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
    const viteConfig = await readFile('vite.config.ts', 'utf8');
    expect(source).toContain("resolve(projectRoot, 'build/bundle-graph.json')");
    expect(viteConfig).toContain("'build/pro-reports/bundle-graph.json'");
    expect(source).not.toContain("resolve(projectRoot, 'dist/.vite')");
  });

  it('downloads review-impact bundle graphs into the build directory in both browser jobs', async () => {
    const expectedAction = 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2';
    for (const workflow of ['.github/workflows/build.yml', '.github/workflows/release.yml']) {
      const source = await readFile(workflow, 'utf8');
      const downloader = source.match(/- name: Download tested bundle graph for browser assertions\n(?<step>(?:\s+.*\n){1,6})/);
      const uploader = source.match(/- name: Upload review impact\n(?<step>(?:\s+.*\n){1,15})/);
      expect(downloader?.groups?.step, `${workflow} bundle graph download step`).toContain(`uses: ${expectedAction}`);
      expect(downloader?.groups?.step).toContain('name: review-impact');
      expect(downloader?.groups?.step).toContain('path: build');
      expect(uploader?.groups?.step, `${workflow} review-impact upload step`).toContain('name: review-impact');
      expect(uploader?.groups?.step).toContain('build/bundle-graph.json');
      expect(uploader?.groups?.step).toContain('build/contract-report/');
      expect(uploader?.groups?.step).toContain('build/review-impact/');
    }
  });

});
