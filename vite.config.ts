import { defineConfig } from 'vite-plus'

export default defineConfig({
  // Library build (tsdown). Every package import stays external: zod, nanoid, node builtins
  // and the framework of each adapter.
  pack: {
    entry: {
      index: 'src/index.ts',
      svelte: 'src/adapters/svelte.ts',
      vue: 'src/adapters/vue.ts',
      solid: 'src/adapters/solid.ts',
    },
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    deps: { neverBundle: true },
  },
  test: {
    globals: true,
  },
  // Lint and type check cover src/ and test/; test/tsconfig.json brings the tests into a program,
  // and test/types.test-d.ts holds the type-level assertions on flatdb()'s collection types.
  lint: {
    ignorePatterns: ['dist/'],
    categories: { correctness: 'error' },
    // ESLint and typescript-eslint "recommended" rules that sit outside Oxlint's correctness category.
    rules: {
      'no-array-constructor': 'error',
      'no-case-declarations': 'error',
      'no-empty': 'error',
      'no-fallthrough': 'error',
      'no-prototype-builtins': 'error',
      'no-regex-spaces': 'error',
      'no-unexpected-multiline': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'preserve-caught-error': 'error',
      'typescript/ban-ts-comment': 'error',
      'typescript/no-empty-object-type': 'error',
      'typescript/no-namespace': 'error',
      'typescript/no-require-imports': 'error',
      'typescript/no-unnecessary-type-constraint': 'error',
      'typescript/no-unsafe-function-type': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
  },
  fmt: {
    singleQuote: true,
    semi: false,
    printWidth: 100,
    sortPackageJson: false,
    // The loop workflow is rolled out verbatim from agent-loop/snippets; leave its formatting alone.
    ignorePatterns: ['dist', 'package-lock.json', '.github/workflows/agent.yml'],
  },
})
