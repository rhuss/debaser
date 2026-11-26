# Deep Review Findings

**Date:** 2026-11-26
**Branch:** 003-patch-ordering
**Rounds:** 1 (plus one follow-up fix from the re-review)
**Gate Outcome:** PASS
**Invocation:** quality-gate

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 1 | 1 | 0 |
| Important | 6 | 6 | 0 |
| Minor | 15 | 13 | 2 |
| Notable | 3 | - | 3 |
| **Total** | **25** | **20** | **5** |

Counts are after deduplication: the correctness agent's pinned own-branch finding and the architecture agent's duplicate pin lookup overlap Codex's finding (FINDING-6, FINDING-14).

**Agents completed:** 5/5 internal (Goal Alignment skipped: no PR) + 2 external tools (CodeRabbit, Codex); Copilot disabled in config.
**Agents failed:** none

## Findings

### FINDING-1
- **Severity:** Critical
- **Confidence:** 95
- **File:** src/cli/main.ts, src/cli/commands/move.ts
- **Category:** production-readiness
- **Source:** production-readiness-agent
- **Round found:** 1
- **Resolution:** fixed (round 1)

**What is wrong:** The terminal `ask` was Bun's `prompt()`, which returns `null` for an empty line as well as for end of input. `move`'s interactive session treated every `null` as end of input, so pressing Enter at "Move which patch?" or "Move another patch?" threw the session away with exit 1. Reproduced on a pty.

**Why this matters:** FR-010 and FR-011 (Enter ends the session and saves) failed on every real terminal; the tests passed only because their stub returned `""`.

**How it was resolved:** New `src/cli/lines.ts` reads answers through `node:readline` (`""` for Enter, `null` only at end of input). `main` passes it as `io.line` on a terminal; `ctx.line` falls back to the sync `ask` for tests. `move` uses `ctx.line` for every question. Verified on a pty: Enter saves with exit 0, Ctrl-D exits 1 with the list unchanged.

### FINDING-2
- **Severity:** Important
- **Confidence:** 95
- **File:** src/cli/main.ts, src/cli/commands/move.ts
- **Category:** production-readiness
- **Source:** production-readiness-agent
- **Round found:** 1
- **Resolution:** fixed (round 1)

**What is wrong:** `prompt()` blocks the event loop, so the SIGINT/SIGTERM handlers ran only after the next answer. Ctrl-C followed by `n` saved the new order and then exited 130; a kill at a prompt left the run lock held until someone typed a line.

**Why this matters:** FR-011 requires an interrupted session to leave the list unchanged; FR-023 makes the lock span the session, so an unkillable prompt blocks every other command.

**How it was resolved:** Same async reader as FINDING-1. Verified on a pty: Ctrl-C exits 130 within 0.6 s, SIGTERM exits 143 at once, the list is unchanged and the lock file is gone.

### FINDING-3
- **Severity:** Important
- **Confidence:** 85
- **File:** src/core/guard.ts
- **Category:** architecture
- **Source:** architecture-agent
- **Round found:** 1
- **Resolution:** fixed (round 1)

**What is wrong:** `refuseWhileRunning` wrote its own stopped-run message instead of using `inProgress` from `src/run/where.ts`, which `build` and `rebase` use. It always suggested `continue` or `rollback`, which is wrong for a stopped rollback.

**Why this matters:** Two refusals for one situation drift apart.

**How it was resolved:** `refuseWhileRunning` moved to `src/run/where.ts` and throws `inProgress(ctx, run)`; `src/core/guard.ts` and its test were removed; the integration test checks the shared message, the stop location and the next steps.

### FINDING-4
- **Severity:** Important
- **Confidence:** 80
- **File:** src/run/propose.ts, src/report/order-note.ts, src/cli/commands/status.ts
- **Category:** architecture
- **Source:** architecture-agent
- **Round found:** 1
- **Resolution:** fixed (round 1)

**What is wrong:** Three copies of the "newest build report, `build` or legacy `rebuild`" walk.

**Why this matters:** The legacy alias and the result shape had to be kept in sync in three places; a miss would make the proposal and the order note disagree on the last build.

**How it was resolved:** `lastBuildResult` and `resultKeys` in `src/report/report.ts`, used by all three.

### FINDING-5
- **Severity:** Important
- **Confidence:** 85
- **File:** src/cli/commands/move.ts
- **Category:** test-quality
- **Source:** test-quality-agent
- **Round found:** 1
- **Resolution:** fixed (round 1)

**What is wrong:** No test reached the FR-016 "keep the current order" branch of the command, including with `--yes`.

**Why this matters:** It is the only guard against applying an order that verifies with more conflicts.

**How it was resolved:** `proposed` is exported with an injectable `compute`; `src/cli/commands/move.test.ts` checks the message, the FR-017 sections and that nothing is saved, with and without `--yes`.

### FINDING-6
- **Severity:** Important
- **Confidence:** 75
- **File:** src/run/propose.ts:63-65
- **Category:** external
- **Source:** codex (also reported by: correctness-agent, architecture-agent)
- **Round found:** 1
- **Resolution:** fixed (round 1, refined after re-review)

**What is wrong:** With `--fetch`, own branches skipped `fetchPatch`: a branch only on origin used a stale remote-tracking ref, and a pinned own branch's commit was never fetched, failing with a misleading "neither local nor on origin" message.

**Why this matters:** FR-020 says `--fetch` fetches the way `build` does, and the suggested `--fetch` did not fix the "no fetched commit" refusal for a pinned branch.

**How it was resolved:** Under `--fetch`, an own branch with a local copy and no pin uses its local tip (FR-021); every other patch goes through `fetchPatch`, as in `build`.

**External tool analysis (Codex):**
> When `--fetch` is used and a `branch` patch exists only on its push remote, this branch skips `fetchPatch` and uses `resolved[i]` from the old `refs/remotes/origin/...` value. The proposal can fail because the commit is missing or use a stale or wrong tip; a missing pinned SHA for a branch patch also is not fetched.

### FINDING-7
- **Severity:** Important
- **Confidence:** 75
- **File:** src/run/propose.ts:54
- **Category:** external
- **Source:** coderabbit
- **Round found:** 1
- **Resolution:** fixed (round 1)

**What is wrong:** Without `--fetch`, a pinned PR that an older report marked `skipped-merged` was skipped even when the pinned commit is not in upstream.

**Why this matters:** The pinned commit was left out of the pair tests and both verifications, unlike `build` and the `--fetch` path.

**How it was resolved:** The report's merged state only skips unpinned patches; a pinned one is skipped only when upstream contains its commit. Covered by a new integration test.

**External tool analysis (CodeRabbit):**
> If an older report marks a PR `skipped-merged`, pinning that PR to an available commit outside upstream still sets `skip=true`. For pinned patches, determine skipping from the pinned commit's ancestry only. Keep historical merged status for unpinned patches.

### FINDING-8 (Minor, fixed)
- **File:** src/core/order.ts:117-137, **Source:** correctness-agent. A patch moved behind a later patch only through a constraint chain had no reason line (FR-017). Fixed: such patches get a line naming the chain ("p3 builds on #2 p2 in c.ts, which goes after p4"); unit test added; the re-review checked 20,000 random cases.

### FINDING-9 (Minor, fixed)
- **File:** src/cli/main.ts, **Source:** production-readiness-agent. The patch list was loaded before the run lock was taken, so a plain `add` could undo a concurrent reorder. Fixed: `main` reloads the list after acquiring the lock for every locking command; the per-command reloads were removed.

### FINDING-10 (Minor, fixed)
- **File:** src/run/propose.ts, **Source:** production-readiness-agent. Several seconds of silence while merge-testing. Fixed: progress lines for the single tests, the pair tests and the verification.

### FINDING-11 (Minor, fixed)
- **File:** src/report/order-note.ts, src/run/propose.ts, **Source:** security-agent. A malformed `result.json` entry threw a TypeError in every `build` (order note) and `move --propose`. Fixed: `resultKeys` skips malformed entries; the new integration test includes them.

### FINDING-12 (Minor, fixed)
- **File:** src/cli/commands/add.ts:54-55, **Source:** architecture-agent. FR-003 was cited for two specs in one comment. Fixed: the second cites spec 001.

### FINDING-13 (Minor, fixed)
- **File:** src/cli/commands/add.ts, **Source:** architecture-agent. A one-use `positioned` variable and a no-op `ctx.list = list`. Removed.

### FINDING-14 (Minor, fixed)
- **File:** src/run/propose.ts:44, **Source:** architecture-agent. A pinned own branch's commit was looked up twice. Removed with FINDING-6.

### FINDING-15 (Minor, fixed)
- **File:** src/cli/commands/move.ts, **Source:** architecture-agent. "Nothing moved" was computed against the identity array in one place and `p.current` in another. Both now use `p.current`.

### FINDING-16 (Minor, fixed)
- **File:** src/cli/commands/list.ts, **Source:** architecture-agent. `ordered` copied `run`'s render options. Both now use `shownAs`; the doc comment no longer claims the list is only shown after a change.

### FINDING-17 (Minor, fixed)
- **File:** tests/integration/order.test.ts, **Source:** test-quality-agent. The FR-020 "merged upstream" skip from the last build report was untested. Added a test (with the pinned exception from FINDING-7).

### FINDING-18 (Minor, fixed)
- **File:** tests/integration/order.test.ts, **Source:** test-quality-agent. US5-3 ("refuses before any merge test") was not pinned down. The stopped-run test now checks that `git count-objects -v` is unchanged.

### FINDING-19 (Minor, fixed)
- **File:** tests/integration/order.test.ts, **Source:** test-quality-agent. No test checked that the run lock is held at the prompts (FR-023). The interactive test and the "Apply this order?" test now read the lock file at every question.

### FINDING-20 (Minor, fixed)
- **File:** src/run/propose.ts, **Source:** re-review (round 1). After FINDING-6, `--fetch` used origin's tip for an own branch whose local copy is behind, unlike the no-fetch path (FR-021). Fixed: a local copy wins in both paths.

### FINDING-21 (Minor, remaining)
- **File:** src/run/propose.ts:106-116, **Source:** test-quality-agent. Every integration fixture yields conflict counts of 0 or 1, so a verification loop that stopped at the first conflict, or reset the base after one, would pass. Needs a fixture with two upstream-conflicting patches and one patch that merges only on an earlier clean one.

### FINDING-22 (Minor, remaining)
- **File:** tests/integration/order.test.ts:290-297, **Source:** test-quality-agent. The SC-005 snapshot compares an empty `rr-cache` and a clean checkout, so it cannot detect changes to existing recorded resolutions or a dirty index. Needs a world with a resolved conflict, a dirty checkout and content hashes.

## Notable Observations

### NOTABLE-1
- **File:** src/core/order.ts:61-76, 127-137
- **Category:** architecture
- **Source:** architecture-agent
- **Description:** The pure ordering module builds finished reason sentences, while every other part of `Proposal` holds indices the view renders. `Participant.commit` is carried but never read by `propose`.
- **Rationale:** Wording or styling changes to reasons have to happen in core; returning constraints and rendering them in the view would separate the layers.

### NOTABLE-2
- **File:** src/run/propose.ts:21-35
- **Category:** correctness
- **Source:** correctness-agent
- **Description:** Without `--fetch`, "merged upstream" comes from the newest build report, not from the last fetch; `move --propose --fetch` writes no report, so a later run without `--fetch` may treat a squash-merged PR differently.
- **Rationale:** FR-020 says "the last fetch"; recording fetch results outside build reports would make both paths agree.

### NOTABLE-3
- **File:** tests/integration/order-perf.test.ts:8
- **Category:** test-quality
- **Source:** test-quality-agent
- **Description:** The SC-004 timing test runs only with `DEBASER_PERF` set.
- **Rationale:** Nothing guards SC-004 by default; a scheduled run or a cheap merge-count check would.

## Post-Fix Spec Coverage

The fix round removed code (`src/core/guard.ts`, duplicated report walks, the own-branch special case in `--fetch`). Every FR was rechecked: FR-022 now lives in `src/run/where.ts` `refuseWhileRunning` (called from `move.ts` and `add.ts`), FR-020/FR-021 in `src/run/propose.ts` `commits`, FR-024 in `src/report/order-note.ts` via `lastBuildResult`. All spec requirements verified after the fix loop.

## Test Suite Results

| Round | Test Command | Exit Code | Failures | Status |
|-------|-------------|-----------|----------|--------|
| 1 | `bun test` (targeted: order, move, lines, report, views, order integration) | 0 | 0 | passed |
| final | `bun test` (full suite) | see REVIEW-CODE.md | | |
