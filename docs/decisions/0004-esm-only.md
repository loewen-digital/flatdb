# 0004 · ESM only, no CommonJS build

## Context

The build emitted `dist/*.cjs` next to the ESM files and `package.json` offered `require` conditions.
The declaration files are ESM-shaped, so CommonJS consumers got ESM types for CJS code
(are-the-types-wrong: "Masquerading as ESM"). Fixing that properly means separate `.d.cts` twins for
a consumer nobody has: every target (SvelteKit, Vite, Workers, Node 20+) imports ESM, and the house
rule for loewen-digital packages is ESM only. The package is an unpublished 0.x.

## Decision

`formats: ['es']` in `vite.config.ts`; `main` points at `dist/index.js`; no `require` conditions.

## Consequences

`require('@loewen-digital/flatdb')` is not supported; CommonJS code uses `await import()`.
Half the build output and the type-mismatch warning are gone.
