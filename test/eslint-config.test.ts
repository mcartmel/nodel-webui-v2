import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

type PrintedConfig = {
  languageOptions?: {
    parserOptions?: { project?: string };
  };
  rules: Record<string, [number, ...unknown[]] | number>;
};

const unsafeRules = [
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-unsafe-return'
];

const root = resolve(import.meta.dirname, '..');
const printedConfigs = new Map<string, PrintedConfig>();

function printConfig(file: string): PrintedConfig {
  const cached = printedConfigs.get(file);
  if (cached) return cached;
  const output = execFileSync(process.execPath, [
    resolve(root, 'node_modules/eslint/bin/eslint.js'),
    '--print-config',
    resolve(root, file)
  ], { cwd: root, encoding: 'utf8' });
  const config = JSON.parse(output) as PrintedConfig;
  printedConfigs.set(file, config);
  return config;
}

function severity(config: PrintedConfig, rule: string): number {
  const value = config.rules[rule];
  return Array.isArray(value) ? value[0] ?? 0 : value ?? 0;
}

describe('ESLint typed configuration contract', () => {
  it.each([
    'src/main.ts',
    'test/vite-config.test.ts',
    'e2e/connectivity.spec.ts',
    'scripts/deploy.mjs'
  ])('uses the ESLint project for %s', (file) => {
    expect(printConfig(file).languageOptions?.parserOptions?.project).toBe('./tsconfig.eslint.json');
  });

  it('keeps promise, unsafe boundary, import, and dead-code rules active', () => {
    const required = [
      '@typescript-eslint/await-thenable',
      '@typescript-eslint/no-floating-promises',
      '@typescript-eslint/no-misused-promises',
      'no-duplicate-imports',
      'no-unreachable',
      '@typescript-eslint/no-unused-vars'
    ];
    for (const file of ['src/main.ts', 'eslint.config.mjs']) {
      const config = printConfig(file);
      for (const rule of required) expect(severity(config, rule), `${file}: ${rule}`).toBe(2);
      for (const rule of unsafeRules) expect(severity(config, rule), `${file}: ${rule}`).toBe(2);
      expect(severity(config, 'no-unused-vars'), `${file}: core no-unused-vars`).toBe(0);
    }
    for (const file of ['test/vite-config.test.ts', 'e2e/connectivity.spec.ts']) {
      const config = printConfig(file);
      for (const rule of required) expect(severity(config, rule), `${file}: ${rule}`).toBe(2);
      for (const rule of unsafeRules.slice(2)) expect(severity(config, rule), `${file}: ${rule}`).toBe(2);
    }
  });

  it('limits dynamic boundary exceptions to tests and CLI scripts', () => {
    expect(severity(printConfig('src/main.ts'), '@typescript-eslint/no-unsafe-assignment')).toBe(2);
    expect(severity(printConfig('src/main.ts'), '@typescript-eslint/no-unsafe-member-access')).toBe(2);
    for (const file of ['test/vite-config.test.ts', 'e2e/connectivity.spec.ts']) {
      expect(severity(printConfig(file), '@typescript-eslint/no-unsafe-assignment')).toBe(0);
      expect(severity(printConfig(file), '@typescript-eslint/no-unsafe-member-access')).toBe(0);
    }
    for (const rule of unsafeRules.slice(2)) {
      expect(severity(printConfig('test/vite-config.test.ts'), rule)).toBe(2);
    }
    for (const file of ['test/nodel-editor.test.ts', 'e2e/authored-page-contract.spec.ts']) {
      expect(severity(printConfig(file), '@typescript-eslint/no-unsafe-call')).toBe(0);
    }
    expect(severity(printConfig('test/vite-config.test.ts'), '@typescript-eslint/no-unsafe-call')).toBe(2);
    for (const rule of unsafeRules.slice(2)) {
      expect(severity(printConfig('scripts/deploy.mjs'), rule)).toBe(0);
    }
    expect(severity(printConfig('scripts/deploy.mjs'), 'no-console')).toBe(0);
    expect(severity(printConfig('eslint.config.mjs'), 'no-console')).toBe(2);
  }, 30_000);
});
