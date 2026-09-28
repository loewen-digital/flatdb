# 0011 · Vite+ is the toolchain, `vp pack` builds the library

## Context

Vite+ 1.0 (MIT, 2026-09) bundles Vite 8, Vitest 5, Oxlint, Oxfmt and tsdown behind one CLI (`vp`) and one config file. Eddy decided on 2026-09-28 to move every loop repo to Vite+ (loewen-digital/agent-loop, T-016). flatdb had Vite library mode with `vite-plugin-dts`, a separate `vitest.config.ts`, and no linter, formatter or type check.

## Decision

`vite-plus` is the toolchain. `vp pack` (tsdown) builds the four entries as ESM with bundled declarations and leaves every package import external. `vp check` formats (Oxfmt: single quotes, no semicolons, width 100, the style the code already had), lints and type-checks `src/` and runs in CI. `typescript/no-explicit-any` stays off: the collection types use `any` by design. `test/` is outside lint and type check, as it was outside `tsconfig.json`: 66 type errors there come from the collection typing (#7) and are fixed with it, not here.

## Consequences

- Same entry points and exports for consumers; unminified JavaScript; one `.d.ts` per entry plus a shared chunk instead of one per source file.
- `npm run check` is part of the validation (step 4 in AGENTS.md, CI).
- When #7 lands, drop `test/` from `lint.ignorePatterns` so the tests are type-checked too.
