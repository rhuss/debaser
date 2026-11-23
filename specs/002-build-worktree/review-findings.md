# Deep Review Findings

**Date:** 2026-11-23
**Branch:** 002-build-worktree
**Rounds:** 2
**Gate Outcome:** PASS
**Invocation:** quality-gate (ship pipeline, review-code stage)

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 0 | 0 | 0 |
| Important | 6 | 6 | 0 |
| Minor | 27 | 14 | 13 |
| Notable | 7 | - | 7 |
| **Total** | **40** | **20** | **20** |

**Agents completed:** 5/5 internal (Goal Alignment skipped: no PR for the branch), 2 re-review passes, plus CodeRabbit and Codex.
**Agents failed:** none. Copilot skipped (disabled in config, CLI not installed).

Duplicates merged: the swallowed `git status` error in `modifiedFiles` was reported by architecture, production and correctness (one finding, F-M1).

## Findings

### F-I1 (Important, fixed in rounds 1 and 2)
- **Confidence:** 75 (round 1), 85 (round 2 re-review)
- **File:** src/run/build.ts, src/steps/install.ts, src/run/verifyloop.ts
- **Category:** correctness (FR-010, SC-004)
- **Source:** correctness agent; round 2 cause from the round 1 re-review

**What is wrong:** A new build directory has no dependencies installed. For a recipe with install triggers but no marker (built-in `rust-cargo`, or any project recipe without `marker`), `installNeeded` compared only the triggers between the directory's HEAD before the run and HEAD, so the first build in a new build directory, a migrated one, or one recreated after a manual delete skipped the install step.

**Why this matters:** FR-010 requires the first build in a new build directory to install. Before this feature, the build ran in the user's checkout, which already had dependencies; now the later steps would run without them.

**How it was resolved:** Round 1 added a run-state flag (`freshTree`) set when `prepare` created the directory. The round 1 re-review showed the flag is lost when the first build fails before its install step (a failed fetch writes no run state; a stop gets rolled back). Round 2 replaced it with a stamp file `debaser-installed` in the worktree's own git directory (`git rev-parse --absolute-git-dir`), written when the install step or rollback's dependency restore passes. Without a marker, a worktree without the stamp installs. Tests: a no-marker recipe installs in a new, a recreated, and a failed-first-build directory, then only on trigger changes (tests/integration/tree.test.ts); a unit test in src/steps/commands.test.ts. The integration test was checked to fail without the stamp.

### F-I2 (Important, fixed in round 1)
- **Confidence:** 75
- **File:** src/git/worktree.ts:11-25, src/core/tree.ts (prepare), src/run/rollback.ts (withoutTree)
- **Category:** security (FR-008)
- **Source:** security agent

**What is wrong:** When `git worktree remove --force` refused, `removeWorktree` deleted every admin directory whose `gitdir` matched the path, without checking why git refused. A worktree locked because its directory is on an unmounted volume lost its registration, HEAD, index and reflog.

**Why this matters:** Commits reachable only from that worktree become collectable, and the worktree may not be one debaser created (a user-set `tree`), which FR-008 forbids touching.

**How it was resolved:** The fallback skips entries with a `locked` file and entries whose directory still exists. `worktreeAt` reports `locked`; `prepare` and `withoutTree` refuse a locked, absent build directory and name `git worktree unlock <path>` (quoted). Tests cover `removeWorktree`, `build` and `rollback` with a locked, absent directory.

### F-I3 (Important, fixed in round 1)
- **Confidence:** 85
- **File:** src/git/git.ts (`modifiedFiles`), called from `inspect()` for `status` and `list`
- **Category:** production readiness
- **Source:** production agent

**What is wrong:** `status` and `list` now run `git status` in the build directory without the run lock. Plain `git status` refreshes and writes the index under `index.lock`, which can make a concurrent build's merge, commit or checkout fail.

**Why this matters:** Running `status` while a build runs is a supported workflow; the race is new with this feature.

**How it was resolved:** `modifiedFiles` runs `git --no-optional-locks status --porcelain -z --untracked-files=no`.

### F-I4 (Important, fixed in round 1)
- **Confidence:** 85
- **File:** tests/integration/tree.test.ts (FR-014 tests)
- **Category:** test quality
- **Source:** test quality agent

**What is wrong:** The FR-014 tests ran `continue` and `rollback` from the same worktree that held the integration branch, so an implementation that ignored `checkedOutIn` and used the start directory would pass.

**Why this matters:** FR-014's core rule is "whichever worktree continue or rollback is started from"; a regression would commit in the wrong checkout.

**How it was resolved:** New test resumes and rolls back a legacy run from a separate linked worktree and checks that the resolution lands in the holding worktree and the started-from worktree is unchanged.

### F-I5 (Important, fixed in round 1)
- **Confidence:** 72
- **File:** tests/integration/tree.test.ts, src/run/rollback.ts (restorePrevious)
- **Category:** test quality (FR-010, FR-013)
- **Source:** test quality agent

**What is wrong:** The installed artifact's `.prev` restore by a no-run rollback was only tested in place, not in the sibling build directory, where `restorePrevious` has its own path logic.

**Why this matters:** An artifact restored against the wrong directory would pass every test.

**How it was resolved:** New test: two builds, a no-run rollback from the main checkout, the artifact in the build directory equals the first build's, and nothing appears in the main checkout's `dist/`.

### F-I6 (Important, fixed in round 2)
See F-I1. Reported by the round 1 re-review: the run-only `freshTree` flag was lost on an interrupted first build. Resolved by the per-worktree install stamp.

### F-M1 (Minor, fixed): `modifiedFiles` swallowed git failures
src/git/git.ts. A failing `git status` returned `[]` ("clean"), letting the FR-007 refusal pass silently. Now throws with git's stderr. Reported by architecture, production and correctness. Test corrupts the index and expects the error.

### F-M2 (Minor, fixed): quoted paths in `modifiedFiles` (CodeRabbit)
src/git/git.ts:107. Non-`-z` porcelain C-quotes special file names, so the refusal listed names that do not exist. Now parses `-z` output, including renames and copies in either column (the work-tree column added after the round 1 re-review).

> **External tool analysis (CodeRabbit):** "Line 107 removes the status prefix but keeps git's C-style quotes. Non-NUL porcelain output quotes filenames that contain special characters. For such a file, `modifiedFiles()` returns a string that does not name the tracked file. Read the status output with `-z` and split it on NUL."

### F-M3 (Minor, fixed): README overstated the checkout guarantee (CodeRabbit)
README.md:64. Commands started in the build directory (or with `tree: "."`) do change that checkout. The sentence now says so.

> **External tool analysis (CodeRabbit):** "If the command starts in the build directory, it changes the checkout it started from. The same is true when `tree` is `"."`."

### F-M4 (Minor, fixed): `restorePrevious` pointed `ctx.repo` at a possibly missing directory
src/run/rollback.ts. `prepare` reads `ctx.repo` through `upstreamRemote`, which spawned git in a nonexistent cwd (ENOENT) in a rare no-run rollback. `installPath(ctx, base)` now takes the directory explicitly. (architecture)

### F-M5 (Minor, fixed): dead `worktreeWith`
src/git/worktree.ts. No callers after the change; removed. (architecture)

### F-M6 (Minor, fixed): unquoted shell hints
src/core/tree.ts, src/run/rollback.ts. The FR-016 `git -C ... switch ...` hint and the `git worktree unlock` hints now quote with `word()`. (security, round 1 re-review)

### F-M7 (Minor, fixed): an existing default build directory was never recorded
src/core/tree.ts. A first build cut short between `worktree add` and saving the patch list left the default unrecorded forever (FR-003). `prepare` now records it on the next run, after every refusal. (production)

### F-M8 (Minor, fixed): `checkoutState` could not see content changes
tests/integration/tree.test.ts. SC-001 requires byte-for-byte unchanged files; the helper now includes `git diff HEAD` and ignored files. (test quality)

### F-M9 (Minor, fixed): `modifiedFiles` unit test leaked a temp repo and ignored setup failures
src/git/git.test.ts. Now cleans up, checks git exit codes, and exercises the failure branch with a corrupt index rather than a missing cwd (round 1 re-review). (test quality)

### F-M10 (Minor, fixed): no test for the locked-directory refusal in rollback
tests/integration/tree.test.ts. Added (round 1 re-review).

### F-M11 to F-M13 (Minor, fixed)
Round 1 re-review items folded into F-M2 (work-tree column renames), F-M6 (unlock hint quoting) and F-M9 (test path) above; counted separately because they were found in a later round.

### F-M14 (Minor, fixed): no test for work-tree column renames
src/git/git.test.ts. Round 2 re-review: the `-z` parser's work-tree rename branch (` R new\0old\0`, from an intent-to-add rename) had no test. Added; the test fails with that branch removed.

### Remaining Minor findings

| ID | File | Finding | Source |
|----|------|---------|--------|
| R-M1 | src/git/worktree.ts, src/core/tree.ts | `git worktree list --porcelain` is parsed by four separate loops (`heldElsewhere`, `checkedOutIn`, `worktreeAt`, `mainWorktree`); one shared parser would avoid drift and repeated subprocesses | architecture |
| R-M2 | src/git/worktree.ts, src/core/tree.ts | Three path-comparison styles (`samePath`, local `same`, bare `realpath ===`) | architecture |
| R-M3 | src/views/config.ts:12, src/core/tree.ts | "missing" vs "not created yet" is decided differently by the header and by `prepare` for a user-set path never created | architecture |
| R-M4 | src/views/config.ts, list.ts, status.ts | Whether a detached HEAD is acceptable depends on `branchExists`, which callers compute differently and the JSON does not carry | architecture |
| R-M5 | src/cli/commands/status.ts, src/core/tree.ts | "first 10 files, then N more" written twice | architecture |
| R-M6 | src/core/tree.ts | `refuseHeldElsewhere` exported but used only in the module | architecture |
| R-M7 | src/core/tree.ts:42-49 | `isOurs` repeats `commonDirOf`'s resolution | architecture |
| R-M8 | src/core/context.ts | `ctx.home` (started-from worktree) vs `$HOME` in status's view model | architecture |
| R-M9 | src/core/tree.ts:101 | The detached-HEAD exemption (integration branch not yet created) accepts any detached worktree of the repo at the build path, not only one debaser created | security |
| R-M10 | src/core/tree.ts (`runTree`) | A legacy run (no `run.tree`) whose rollback deleted the integration branch and then failed at the dependency restore cannot be finished with `continue` | correctness |
| R-M11 | tests/integration/tree.test.ts | FR-007 refusal tests check message and exit code, not that nothing changed | test quality |
| R-M12 | tests/integration/tree.test.ts | Assertions behind comments at the first-run rollback and gone-directory rebuild (FR-009 "(it was missing)") | test quality |
| R-M13 | tests/integration/tree.test.ts | Spec edge cases without a test: two data directories, no-run rollback refused for modified files, `continue` from the build directory or a third worktree, sibling-mode step-fix continue, acceptance stop naming the build directory, harness-merge cwd, detached and "in place, N modified" status, `{{tree}}` template field | test quality |

## Notable Observations

### NOTABLE-1
- **File:** src/views/recipe.ts:9-14, src/recipes/trust.ts:36
- **Category:** architecture
- **Description:** Layer sources are parsed back out of layer id strings (`repo:<path>@<sha7>`).
- **Rationale:** A change to the id format silently turns repo layers into "built-in"; the resolver could attach a structured source.

### NOTABLE-2
- **File:** src/views/config.ts:4-7
- **Category:** architecture
- **Description:** `ConfigInfo` is `ReturnType<typeof configInfo>` in the view rather than a named type in core.
- **Rationale:** The data model's config shape has no named home.

### NOTABLE-3
- **File:** src/run/common.ts, src/run/finish.ts
- **Category:** security
- **Description:** Absolute `artifact.install`/`artifact.output` paths (as the spec allows) apply to trusted repository recipes too.
- **Rationale:** Not wider than before (`../` already escaped, steps run arbitrary commands), but `debaser trust` could point it out.

### NOTABLE-4
- **File:** src/cli/commands/list.ts
- **Category:** production readiness
- **Description:** `list` now spawns about eight git processes, including a `git status` of the build directory.
- **Rationale:** `list` only needs paths and "not created yet"; the modified-file state is a `status` concern.

### NOTABLE-5
- **File:** src/core/tree.ts:114-120
- **Category:** production readiness
- **Description:** The first build's `git worktree add --quiet` is a full checkout plus a fresh install with only a one-line progress message; disk cost is not documented.
- **Rationale:** Looks hung on big repositories and invites Ctrl-C.

### NOTABLE-6
- **File:** src/run/build.ts:57-60
- **Category:** correctness
- **Description:** The comment says the directory is created after every other refusal, but fetch failures and the headless trust refusal come later and can leave a new, valid directory.
- **Rationale:** Not an FR-007 refusal; the directory is reused. Comment or ordering could be tightened.

### NOTABLE-7
- **File:** src/steps/install.ts
- **Category:** correctness
- **Description:** Existing build directories (and in-place checkouts) with a no-marker recipe install once after upgrading, because they have no stamp yet.
- **Rationale:** One-time cost; worth a release-note line.

## Post-Fix Spec Coverage

The fix rounds removed one function (`worktreeWith`, dead) and a run-state field added in round 1 (`freshTree`), replacing it with the install stamp. Every FR touched by the fixes was rechecked: FR-003, FR-007, FR-008, FR-009, FR-010, FR-013, FR-014, FR-016, FR-017 and FR-022 still have implementations and tests. All spec requirements verified after the fix loop.

## Test Suite Results

| Round | Test Command | Exit Code | Failures | Status |
|-------|-------------|-----------|----------|--------|
| 1 | `bun test` (full suite) | 0 | 0 | passed (386 tests) |
| 2 | `bun test` (full suite) | 0 | 0 | passed (388 tests) |

One targeted failure during round 2 (the new no-marker test, before rollback's dependency restore wrote the stamp) was fixed in the same round. Each new regression test was checked to fail with its fix reverted.

## Remaining Findings

No Critical or Important findings remain. The 13 Minor findings above are refactors, consistency improvements and additional test coverage; none blocks the spec.
