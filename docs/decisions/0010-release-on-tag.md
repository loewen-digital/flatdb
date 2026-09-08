# 0010 · A pushed tag is the release: trusted publishing, notes from `CHANGELOG.md`

## Context

Nothing published on tags; `v0.2.0` went out as a tag only. fullstack carries a `publish.yml` with an
`NPM_TOKEN` secret and a `changelog.yml` that lets git-cliff write release notes from commit messages.
npm has revoked classic tokens and expires granular ones, and the loop already curates `CHANGELOG.md`
by hand in a fixed heading format that apps show as release notes.

## Decision

One `release.yml` on `push: tags: v*`: the tag must equal the `package.json` version, tests and build
run, `npm publish` goes through npm trusted publishing (OIDC, `id-token: write`, provenance automatic),
and `gh release create` takes the `## v<version>` section of `CHANGELOG.md` as title and notes. No secret,
no cliff config. The canonical copy lives in `agent-loop/snippets/release.yml` for every loop repo.
`LICENSE` (MIT) and `repository` in `package.json` come along; provenance needs the latter.

## Consequences

The first version of a package is published by hand, then the trusted publisher is registered once on
npmjs.com. From then on a release is: move the Unreleased lines, bump, commit, tag, push. Commit messages
need not be release-notes quality. fullstack's two workflows are to be replaced by this one.
