# 0014 · `ci.yml` is the library shape of the org snippet

## Context

Every loop repo runs CI from loewen-digital/agent-loop `snippets/ci.yml` (FRAMEWORK.md, recipe step 3), so one setup can be read and changed everywhere at once. flatdb had its own `ci.yml`: one job `ci`, no `concurrency`, `paths-ignore`, `timeout-minutes` or manual trigger. The repo is public, so minutes are not the reason; sameness is. (#12)

## Decision

`ci.yml` is the snippet minus what a library does not have: no `e2e` and `deploy` jobs, no `tags` trigger, no Cloudflare `env`. One job `verify` ("Check, unit, build", 10 minutes): `npm ci`, `npm run check`, `npm test`, `npm run build`, on pushes to `main` that touch more than `docs/**` and `**.md`, on pull requests and by hand. `concurrency` cancels a superseded run; its `cancel-in-progress` expression stays verbatim from the snippet so the files diff cleanly. The tag guard stays in `release.yml`.

## Consequences

- A docs-only push to `main` runs no CI. A pull request always runs, docs or not.
- A change to the snippet is copied here by hand; the diff against it shows only the removed jobs, trigger and env.
