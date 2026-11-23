# debaser Guide style guide

Project terms and rules that every page follows, on top of the built-in style rules. Page implementers and reviewers read this file. Keep one rule per bullet.

## Terms

- "debaser" is always written in lowercase, also at the start of a sentence and in headings.
- "patch list" means the ordered list of patches in `patches.json`; not "patch set" or "patch queue".
- "build directory" means the linked worktree that holds the integration branch; not "build tree" or "build worktree" in prose.
- "integration branch" means the branch debaser builds (default `debaser`); "previous build" means `debaser-prev`.
- "upstream" means the original repository the patched build follows.
- "recipe" means a build recipe; "acceptance check" means a per-patch check; "project checks" are the recipe's checks.
- "harness" means the configured AI agent integration; "agent" means the CLI the harness runs.
- Product names are spelled exactly: debaser, Git, GitHub, GitHub CLI (`gh`), Bun, Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`), pi (`pi`).
- Persona names: "User" and "Recipe author".

## Rules

- No em dash or en dash characters.
- AsciiDoc pages: one sentence per line.
- Versions and commits come from the baseline attributes, never typed.
- Command names and subcommands are code: `debaser build`, `debaser continue`.
- Task pages: a short paragraph on why, then numbered steps, then a `Check:` line with the expected result.
