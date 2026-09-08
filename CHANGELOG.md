# Changelog

All notable changes to flatdb, newest first. SemVer, 0.x is pre-release. The heading
format is a contract, keep it: `## v<Version> · <YYYY-MM-DD> · <Title>`. Lines under
`## Unreleased` move under the next version heading at release; the version in `package.json`
is the topmost released one here.

## Unreleased

- Types for the `./svelte`, `./vue` and `./solid` imports resolve again; the exports pointed at declaration files the build never emits.
- The npm tarball now contains `dist`; without a `files` field npm followed `.gitignore` and packed the sources without the built entry points. `npm pack` and `npm publish` rebuild first.
- Agent rules live in `AGENTS.md`; `CLAUDE.md` only imports it. The Codex review rules are a section of the same file.
