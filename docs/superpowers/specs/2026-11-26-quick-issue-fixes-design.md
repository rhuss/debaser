# Quick issue fixes: #1, #3, #4, #5, #6, #7, #8

## Intent

Close the seven open `cc-review:pursue` issues that need no design work, in one PR, so the docs, specs, usage text and outputs agree with the code again. #2 (attribution narrowing) stays open; it needs a choice between ranking and pairwise confirmation first. Release binaries and Homebrew moved to #12 and #13.

## Goals, non-goals

- Goal: each issue's acceptance or proposal met, with tests for every behavior change.
- Non-goal: release workflow, Homebrew, attribution changes, reordering `tree.prepare` in `build.ts`.
- Anti-goal: changing behavior beyond what an issue asks for.

## Approaches

1. **One PR, one commit per issue** (picked). Each commit reviewable and revertable on its own; the PR body has `Fixes #N` for all seven.
2. One PR, one squashed commit. Harder to review per issue or revert one fix.
3. Separate PRs for docs and code. Ruled out by the owner: one PR wanted.

## Decisions per issue

**#7 comments and one error message**
- `src/run/build.ts:59` comment: say the build directory is created before the upstream fetch and the trust check, which can still refuse and leave it behind. No reorder (the fetch runs in the build directory).
- `src/git/refs.ts:3` comment: fetched refs live under `refs/debaser/`; the integration branch and its `-prev` backup are ordinary branches under `refs/heads/`.
- `src/recipes/resolve.ts:60` message: "step <name> is placed before <other>, which is not among the steps so far". Test updated.

**#6 usage text and hints**
- `src/cli/usage.ts`: add `add --description`, `list --retired`, `--trust-recipe` on `rebase` and `continue`.
- `recipe` no longer accepts `--trust-recipe`: drop it from the verb table, so the parser refuses it with a usage error. Test added.
- `add` no-upstream-remote hint: say that with `--upstream` and no `upstream` remote, upstream is fetched from `origin`, and suggest adding the `upstream` remote when `origin` is a fork.
- Untrusted-recipe refusal for `rollback`: offer only `debaser trust`, not `--trust-recipe`. Test added.

**#4 docs drift** (README.md, docs/harness.md, docs/pilots.md): the nine items as proposed in the issue. Install section: build from source with Bun 1.4.4 (the version CI tests); the release-binary sentence goes until #12 lands.

**#5 spec drift**
- Spec 001: supersede note for `rebuild` (now `build`); FR-039a key corrected to `steps_replace = true`; FR-008a and FR-009 marked superseded by spec 002, as other replaced requirements are.
- FR-020 kept; `recipe --json` gains the `config` object from `configInfo(ctx)`, like `list` and `status`. Test added.

**#8 status and result.json**
- `status`: a PR source whose state `gh` can't give shows `unknown`; `not a PR` stays for other sources.
- `report.md`: a finished build whose integration push failed reads `Result: failed (exit 1)`, matching `outcome: failed` in `result.json`.
- `result.json`: the `pr` object only for PR sources. Other sources with a link (fork branches) get it as `link: <url>`. `data-model.md` updated.

**#3 diverged warning**
- The "rebased earlier, push pending" condition from `src/rebase/rebase.ts:210-215` moves into a shared helper used by both the rebase phase and the branch source.
- When it holds, the branch source's note becomes `rebased earlier, push pending; using the local branch` (no `warning:` prefix). A real divergence keeps the warning.
- `status` shows `rebasing, checking` while `refs/debaser/rebase-checking/<b>` exists and `build`, `rebase` or `continue` holds the lock, instead of `! diverged from origin` or `✓ up to date`. A marker left by a killed run is ignored.

**#1 after_build = []**
- The schema accepts an empty `after_build` array in any layer and means "no after-build command"; non-arrays and non-string items keep the current message.
- A later layer's `[]` clears an inherited command; `debaser recipe` shows `after_build none <layer>`; `recipe --json` gives `afterBuild: []` (null still means never set).
- `finish.ts` runs nothing for an empty list. Tests for validation, the view and a build that runs no after-build command.

## Left to the builder

Exact wording of the README and spec edits within the issue proposals, test placement, helper name and module for the push-pending check.
