# 0010 · A pushed tag is the release: trusted publishing, notes from `CHANGELOG.md`

## Context

Nothing published on tags; `v0.2.0` went out as a tag only. fullstack carries a `publish.yml` with an
`NPM_TOKEN` secret and a `changelog.yml` that lets git-cliff write notes from commit messages. npm has
revoked classic tokens and expires granular ones; the loop already curates `CHANGELOG.md` by hand.

## Decision

One `release.yml` on `push: tags: v*`: the tag must equal the `package.json` version, tests and build run,
`npm publish` goes through npm trusted publishing (OIDC, `id-token: write`, provenance automatic), and
`gh release create` takes the `## v<version>` section of `CHANGELOG.md` as title and notes. No secret, no
cliff config. Canonical copy: `agent-loop/snippets/release.yml`. `LICENSE` (MIT) and `repository` come along.

## Consequences

The first version of a package is published by hand, then the trusted publisher is registered once on
npmjs.com. From then on a release is: move the Unreleased lines, bump, commit, tag, push. Commit messages
need not be release-notes quality. fullstack's two workflows are to be replaced by this one.
