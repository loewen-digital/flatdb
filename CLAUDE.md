# FlatDB

Flat-file document database for TypeScript/JavaScript.

## Reference

- Full API design: see `flatdb-api-design.md`
- Package: `@loewen-digital/flatdb`
- Tooling: npm (no yarn/pnpm)
- Format: JSON (fixed, not configurable)
- Schema: Zod
- No React

## Architecture

- Core is framework-agnostic
- StorageAdapter pattern (FsAdapter, IndexedDBAdapter, MemoryAdapter)
- 1 JSON file per document
- _index.json per collection for fast queries
- Reactivity via internal EventEmitter in Core

## Agent Loop (GitHub Actions)

Claude runs unattended via `.github/workflows/agent.yml`. Nobody answers questions.

**Issue** (label `ready`):

1. Read the issue: `gh issue view <n> --json title,body,labels,comments`. If acceptance criteria are missing: comment the concrete question, add label `needs-human`, remove `ready`, stop.
2. Branch `claude/issue-<n>-<slug>` from the default branch.
3. Implement following the rules above. If something is missing in one of our own libraries (fullstack, flatdb, sveltekit-ai-orchestrator, element-js, element-js-ssr-renderer, element-library): open an issue there (`gh issue create --repo <owner/lib>`), add the smallest workaround marked `// UPSTREAM: <issue-url>`, keep going. Never wait for upstream.
4. `npm test && npm run build` must pass. After three failed attempts: open a draft PR, label `needs-human`, stop.
5. Review your own diff: security, dead code, error handling, accessibility.
6. Open the PR (`gh pr create`): summary, `Closes #<n>`, test plan, and say explicitly whether auth, payments, schema, or secrets are touched. Then post `@codex review` as a PR comment.

**Review** (a review on a `claude/*` PR):

1. Read reviews and inline comments since the last commit (`gh pr view <n> --json reviews,comments`, `gh api repos/{owner}/{repo}/pulls/<n>/comments`). Nothing to do: stop, no comment.
2. Fix every point or explain in the thread why not. Never dismiss a security finding.
3. Validation green, push, comment `@codex review`. After three fix rounds on one PR: `needs-human`, stop.

**Always:**

- Never ask. Blocked means: comment the question with options, `needs-human`, stop.
- One issue, one branch, one PR. Conventional commits (`feat:`, `fix:`, `chore:`, ...). Never force-push. Never commit secrets.
- Eddy merges, not the agent.
- Never create or modify files under `.github/workflows/`: the App token lacks the `workflows` scope and the push is rejected. Describe the needed workflow change in a `needs-human` issue instead and continue.
