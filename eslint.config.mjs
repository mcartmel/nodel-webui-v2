import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// These tests intentionally exercise private custom-element methods, Vitest
// module mocks, or dynamic contract fixtures rather than typed production APIs.
const mockUnsafeCallFiles = [
  'test/component-contract.test.ts',
  'test/control-action-semantics.test.ts',
  'test/control-runtime.test.ts',
  'test/deployment-tools.test.ts',
  'test/node-console-source.test.ts',
  'test/node-restart-source.test.ts',
  'test/nodel-actsig.test.ts',
  'test/nodel-button.test.ts',
  'test/nodel-description.test.ts',
  'test/nodel-diagnostic-charts-jsviews-lifecycle.test.ts',
  'test/nodel-editor.test.ts',
  'test/nodel-editor-jsviews-lifecycle.test.ts',
  'test/nodel-host-log-poll-lifecycle.test.ts',
  'test/nodel-params.test.ts',
  'test/nodel-palette.test.ts',
  'test/nodel-script-reload.integration.test.ts',
  'test/prepare-release.test.ts',
  'test/nodel-segmented.test.ts',
  'test/nodel-select.test.ts',
  'test/nodel-stepper.test.ts',
  'test/nodel-toggle.test.ts',
  'e2e/authored-page-contract.spec.ts'
];

const mockUnsafeArgumentFiles = [
  'test/bindings-model.test.ts',
  'test/component-contract-artifact.test.ts',
  'test/nodel-actsig-jsviews-lifecycle.test.ts',
  'test/nodel-actsig.test.ts',
  'test/nodel-add-node.test.ts',
  'test/nodel-diagnostic-charts-jsviews-lifecycle.test.ts',
  'test/nodel-editor-jsviews-lifecycle.test.ts',
  'test/nodel-editor.test.ts',
  'test/nodel-host-client.test.ts',
  'test/nodel-diagnostic-charts.test.ts',
  'test/nodel-node-list.test.ts',
  'test/nodel-node-menu-jsviews-lifecycle.test.ts',
  'test/nodel-palette.test.ts',
  'test/nodel-script-reload.integration.test.ts',
  'test/prepare-release.test.ts',
  'test/schema-form-pure.test.ts',
  'e2e/authored-page-contract.spec.ts'
];

const mockUnsafeReturnFiles = [
  'test/activity-accumulator.test.ts',
  'test/bindings-target-discovery.test.ts',
  'test/component-contract-artifact.test.ts',
  'test/component-contract.test.ts',
  'test/control-action-semantics.test.ts',
  'test/nodel-actsig-jsviews-lifecycle.test.ts',
  'test/nodel-actsig.test.ts',
  'test/nodel-button.test.ts',
  'test/nodel-diagnostic-charts-jsviews-lifecycle.test.ts',
  'test/nodel-editor-jsviews-lifecycle.test.ts',
  'test/nodel-fader.test.ts',
  'test/nodel-host-log-poll-lifecycle.test.ts',
  'test/node-activity-source.test.ts',
  'test/node-console-source.test.ts',
  'test/nodel-node-menu-jsviews-lifecycle.test.ts',
  'test/nodel-pad.test.ts',
  'test/nodel-page-actions.test.ts',
  'test/nodel-palette.test.ts',
  'test/nodel-script-reload.integration.test.ts',
  'test/nodel-segmented.test.ts',
  'test/nodel-select.test.ts',
  'test/nodel-stepper.test.ts',
  'test/nodel-toggle.test.ts',
  'e2e/authored-page-contract.spec.ts'
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.kilo/**']
  },
  eslint.configs.recommended,
  {
    files: ['src/types/{identicon,pagedown,jsviews,xxhashjs}.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off'
    }
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx,mjs,cjs}']
  })),
  {
    files: ['**/*.{ts,tsx,mjs,cjs}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
        JQuery: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreIIFE: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: true }],
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      'no-unreachable': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-console': 'error'
    }
  },
  {
    files: mockUnsafeCallFiles,
    rules: { '@typescript-eslint/no-unsafe-call': 'off' }
  },
  {
    files: mockUnsafeArgumentFiles,
    rules: { '@typescript-eslint/no-unsafe-argument': 'off' }
  },
  {
    files: mockUnsafeReturnFiles,
    rules: { '@typescript-eslint/no-unsafe-return': 'off' }
  },
  {
    files: ['test/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // DOM and Vitest mock objects expose intentionally dynamic members.
      // Calls, arguments, returns, and all promise rules remain checked.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Async fetch and DOM adapters intentionally model Promise-returning
      // collaborators without scheduling work in the mock itself.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off'
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-console': 'error'
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      // CLI contracts consume intentionally dynamic JSON and filesystem data.
      // Promise correctness remains active; these five unsafe rules are the
      // explicit dynamic-boundary exception for untyped Node CLI contracts.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off'
    }
  },
  {
    files: [
      'src/api/codecs/nodel-codecs.ts',
      'src/components/nodel-editor.ts',
      'src/utils/edge-whitespace.ts',
      'src/utils/node-file-path.ts',
      'src/utils/node-name.ts',
      'src/utils/urls.ts',
      'scripts/deployment-contract.mjs'
    ],
    rules: {
      'no-control-regex': 'off'
    }
  },
  {
    files: ['src/types/jsviews.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
);
