# AGENTS.md

Read `CLAUDE.md` first. It holds every rule for this repository, including the agent loop.

## Review rules (Codex)

- Judge the PR against the linked issue's acceptance criteria and the rules in `CLAUDE.md`.
- Acceptance criteria are binding, the issue's proposed solution is not. A PR that copies the proposal where a solution matching this project's conventions would fit better is a finding. Deviations must be explained under "Deviations from the issue".
- Report security issues, correctness bugs, missing or tautological tests, and rule violations. Skip formatting and naming taste.
- Say explicitly if the PR touches auth, payments, schema, or secrets.
- Findings first, with file and line. No praise, no diff summary.
