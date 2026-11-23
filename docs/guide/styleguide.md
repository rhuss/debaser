# debaser Guide style guide

Project terms and rules that every page follows, on top of the built-in style rules. Page implementers and reviewers read this file. Keep one rule per bullet.

## Terms

- "debaser" is always written in lowercase, also at the start of a sentence and in headings.
- "patch list" means the ordered list of patches in `patches.json`; not "patch set" or "patch queue".
- "build directory" means the linked worktree that holds the integration branch; not "build tree" or "build worktree" in prose.
- "integration branch" means the branch debaser builds (default `debaser`); "previous build" means `debaser-prev`.
- "upstream" means the original repository the patched build follows.
- "recipe" means a build recipe.
- "recipe step" (short "step" once the context is clear) means one named command of the recipe; not "project checks". Bare "check" or "checks" in prose must say which it means: recipe steps, acceptance checks, or both. Labels debaser prints (CHECKS, `checks`) stay verbatim.
- "acceptance check" means the per-patch command; write the full term in prose, except right after it was named in the same paragraph.
- "harness" means the configured integration (the `harness` section of `patches.json`); "agent" means the CLI program the harness runs, which does the work. The agent resolves, fixes, or gives up; the harness is set up, configured, broken, or cannot run.
- "build output" means the file the build produces (`artifact.output`); "installed artifact" means the installed file (`artifact.install`). Not "installed copy", and no bare "artifact" in prose outside code or printed output.
- "clone" means your own repository and its main working tree; "build directory" means debaser's linked worktree. Not "checkout" or "main checkout" as a noun for either; "checkout" stays only for a patch branch's working tree in a handoff ("that branch's checkout") and for `git checkout`.
- "attempt" means one run of the agent on one problem, as counted by `attempts`; not "try" or "tries" as a noun. A step or acceptance check that debaser reruns in case it is flaky has "a first run" and "a rerun", not attempts.
- "plain upstream" means the fetched upstream commit without any patches merged; define it or link Key concepts at first use on a page.
- "live view" means the progress card debaser redraws on a color terminal during a build; define it or link Key concepts at first use on a page.
- "data directory" means debaser's directory for a clone (default `<git-common-dir>/debaser`); gloss it or link Key concepts at first use on a page.
- Product names are spelled exactly: debaser, Git, GitHub, GitHub CLI (`gh`), Bun, Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`), pi (`pi`).
- Persona names: "User" and "Recipe author".

## Rules

- No em dash or en dash characters.
- AsciiDoc pages: one sentence per line.
- Versions and commits come from the baseline attributes, never typed.
- Command names and subcommands are code: `debaser build`, `debaser continue`.
- Task pages: a short paragraph on why, then numbered steps, then a `Check:` line with the expected result.
