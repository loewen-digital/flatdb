# 0009 · The April build is recorded retroactively as v0.1.0

## Context

Five months produced two states: the initial build of 2026-03-31 to 2026-04-01 (core, path mode, references,
reactivity, Memory/IndexedDB and framework adapters) and the September work (R2, ESM only, the fixes from the
review in `tasks.md`). Nothing was tagged or published; `package.json` said 0.1.0 all along and `CHANGELOG.md`
had no release heading, only `## Unreleased` with the September lines.

## Decision

Two headings instead of one: `v0.1.0 · 2026-04-01` for the April build, reconstructed from the README and the
commits, and `v0.2.0 · 2026-09-08` for the September lines. `package.json` goes to 0.2.0, the first version
published to npm. Tag `v0.1.0` points at 009621a, the last April commit. Splitting September further was
rejected: one day, one session. The `chore(agent)` and `docs(agent)` commits are repo-internal and stay out.

## Consequences

Lines like "types resolve again" or "the CommonJS build is gone" read against a real prior version. v0.1.0 exists
as a git tag and a changelog section only, not on npm. From here on, one small 0.x release per finished topic.
