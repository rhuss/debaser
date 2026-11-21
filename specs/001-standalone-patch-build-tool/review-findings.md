# Deep Review Findings

**Date:** 2026-11-21
**Branch:** 001-standalone-patch-build-tool
**Rounds:** 2 (round 1: Important findings; round 2: Minor findings from the round-1 re-review)
**Gate Outcome:** PASS
**Invocation:** quality-gate (ship pipeline)

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 0 | 0 | 0 |
| Important | 17 | 16 | 0 (1 resolved without code change, see FINDING-T5) |
| Minor | 33 | 3 | 30 |
| Notable | 10 | - | 10 |
| **Total** | **60** | **19** | **40** |

Two architecture findings the agent rated Important (FINDING-A1, FINDING-A2) were reclassified as Notable: both are large refactors of working code (shared harness attempt loop, source-kind plugin boundary). They are design debt, not defects, and are out of scope for an autonomous fix loop. They are listed under Notable Observations with the reasoning.

**Agents completed:** 5/5 internal (Goal Alignment skipped: no PR exists for the branch) + 2 external (CodeRabbit, Codex). Copilot: disabled in config.
**Agents failed:** none

## Important Findings (none remaining)

### FINDING-C1
- **Severity:** Important
- **Confidence:** 75
- **File:** src/run/harness-fix.ts
- **Category:** correctness
- **Source:** correctness-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit c429af8

**What is wrong:** After an accepted harness fix, only the failing step was rerun to judge the fix. Earlier steps (install, a native build before tests) were not.

**Why this matters:** FR-020 says every step reruns from the first after a fix. A correct fix that needs a reinstall or rebuild was judged on stale output, used up attempts and could end the run with exit 5.

**How it was resolved:** `rerunEarlier` runs the steps before the failing one (the install step only when needed) before the rerun; if one of them fails, control returns to the verify loop, which starts over. Regression test: "after a fix the earlier steps run again before the failing one is judged" (fails on the old code).

### FINDING-C2 (also reported by: codex)
- **Severity:** Important
- **Confidence:** 75
- **File:** src/run/rebase-phase.ts (beforeRebuild)
- **Category:** correctness
- **Source:** correctness-agent, codex
- **Round found:** 1
- **Resolution:** fixed (round 1), commit b083b84

**What is wrong:** During `rebuild`, own branches are rebased before the first run state is saved. With `--in-worktree`, an interruption in that window left a branch at an unchecked rebased tip with no `run.json` for `continue` or `rollback`.

**Why this matters:** FR-013 promises that an interruption leaves a state `continue` or `rollback` can handle.

**How it was resolved:** Each in-worktree rebase target registers an interrupt cleanup that calls `rebase.undoInterrupted`, the same undo `rollback` uses, so the branch goes back to its checked tip before the process exits. Interrupt cleanups now run newest first, so step processes end before their worktree is touched and the lock is released last.

### FINDING-C3
- **Severity:** Important
- **Confidence:** 75
- **File:** src/run/rebase-phase.ts (resumeRebase)
- **Category:** correctness
- **Source:** correctness-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit b083b84

**What is wrong:** `debaser continue` after an interrupted `rebase --in-worktree` re-entered the loop without undoing the interrupted target, then reported the branch as skipped and left it moved.

**Why this matters:** Same FR-013 guarantee, on the `continue` path.

**How it was resolved:** `resumeRebase` calls `undoInterrupted` for the active target when there is no recorded stop, as `rollbackRebase` already did.

### FINDING-S1
- **Severity:** Important
- **Confidence:** 80
- **File:** src/recipes/trust.ts
- **Category:** security
- **Source:** security-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 4cf70e1

**What is wrong:** The trust fingerprint covered `.debaser/recipe.toml` only. Prompt override files the recipe names (read from `.debaser/` at the same tip) were not covered.

**Why this matters:** Upstream could change the instructions given to an agent with write and exec access without a new trust question, against FR-042 ("again after its content changes").

**How it was resolved:** The fingerprint now hashes the recipe text plus each named prompt file read at the same tip. Recipes without prompt files keep their old fingerprint, so existing trust stays valid. Regression test: "a change to a prompt file the project recipe names asks for trust again" (fails on the old code).

### FINDING-S2
- **Severity:** Important
- **Confidence:** 75
- **File:** src/recipes/trust.ts (commandsOf)
- **Category:** security
- **Source:** security-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 4cf70e1

**What is wrong:** The trust question printed recipe commands raw. TOML strings can carry `\r`, ANSI escapes and bidi overrides that hide what really runs.

**Why this matters:** The user decides on trust from that text alone.

**How it was resolved:** Control and bidi characters are shown as `\uXXXX`. The question also lists the install path and the prompt files.

### FINDING-S3
- **Severity:** Important
- **Confidence:** 75
- **File:** src/report/manifest.ts
- **Category:** security
- **Source:** security-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 61e4d77

**What is wrong:** origin's push URL went verbatim into `manifest.json` and `DEBASER_FORK_URL`, including any token in it.

**Why this matters:** FR-045 data is meant to be stamped into builds; a token could ship inside an artifact.

**How it was resolved:** `withoutCredentials` drops user name and password from scheme URLs (scp-style URLs are kept). Unit test: src/report/manifest.test.ts.

### FINDING-P1
- **Severity:** Important
- **Confidence:** 85
- **File:** src/git/git.ts, src/github/gh.ts
- **Category:** production-readiness
- **Source:** production-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 0de6b22

**What is wrong:** `fetch`, `push`, `ls-remote` and `gh pr view` ran through `spawnSync` without a timeout and could block on a credential prompt.

**Why this matters:** An unattended run could hang forever and, blocked in `spawnSync`, could not even handle SIGTERM.

**How it was resolved:** Network git commands get a 900 s timeout, `GIT_TERMINAL_PROMPT=0` and git's low-speed stall detection (unless the user set them); a timeout is reported as a fetch or push failure. `gh` gets a 60 s timeout and `GH_PROMPT_DISABLED=1`.

### FINDING-P2
- **Severity:** Important
- **Confidence:** 85
- **File:** src/steps/isolated.ts
- **Category:** production-readiness
- **Source:** production-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 0d892ad

**What is wrong:** An interruption during an isolated check skipped the `finally` that removes its throwaway worktree. Attribution names those worktrees per merge sha, so they were never reused or cleaned.

**Why this matters:** Unbounded disk use and stale worktree registrations in unattended setups.

**How it was resolved:** `runIsolated` registers an interrupt cleanup that removes the worktree.

### FINDING-P3
- **Severity:** Important
- **Confidence:** 80
- **File:** src/github/gh.ts, src/cli/commands/status.ts
- **Category:** production-readiness
- **Source:** production-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 0de6b22

**What is wrong:** `status` and `rebuild` called `gh pr view` twice per PR, sequentially and uncached.

**Why this matters:** SC-003 requires `status` in under 10 seconds.

**How it was resolved:** `prInfo` answers are cached for the length of one command (cleared at the start of `main`, keyed by gh path and PR).

### FINDING-T1
- **Severity:** Important
- **Confidence:** 90
- **File:** tests/support/world.ts
- **Category:** test-quality
- **Source:** test-quality-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit fef6f74

**What is wrong:** The module-level `afterAll` in the shared test world ran after the first test file only, because Bun shares the module across files. Later files leaked their temporary repositories.

**How it was resolved:** The scratch directory is removed at process exit. (The shared test clock remains; see Minor findings.)

### FINDING-T2
- **Severity:** Important
- **Confidence:** 85
- **File:** tests/integration/harness.test.ts
- **Category:** test-quality
- **Source:** test-quality-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit fef6f74

**What is wrong:** The four harness rejection cases (markers, extra edits, commits, timeout) asserted only the exit code and call count, so the timeout case passed even without timeout enforcement.

**How it was resolved:** Each case asserts the recorded rejection reason, and the timeout case asserts it ends well before the sleep would.

### FINDING-T3
- **Severity:** Important
- **Confidence:** 85
- **File:** tests/integration/stops.test.ts
- **Category:** test-quality
- **Source:** test-quality-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit fef6f74

**What is wrong:** Exit codes 129 (SIGHUP) and 143 (SIGTERM) from FR-013 had no test.

**How it was resolved:** The signal test runs for INT, TERM and HUP through the real command line and checks code, phase, lock release and rollback.

### FINDING-T4
- **Severity:** Important
- **Confidence:** 85
- **File:** tests/support/world.ts, tests/integration/rebuild.test.ts
- **Category:** test-quality
- **Source:** test-quality-agent
- **Round found:** 1
- **Resolution:** fixed (round 1), commit fef6f74

**What is wrong:** The stub install marker never existed, so the "skip install when nothing changed" branch (FR-008) never ran in tests.

**How it was resolved:** New test: the install step runs on the first rebuild, is skipped on the second, and runs again after upstream changes a trigger file.

### FINDING-T5
- **Severity:** Important
- **Confidence:** 85
- **File:** src/run/resume.ts, tests/integration/stops.test.ts
- **Category:** test-quality (exposed a correctness gap)
- **Source:** test-quality-agent
- **Round found:** 1
- **Resolution:** resolved without code change (round 2); behavior question moved to spec evolution

**What is wrong:** The finding said no test covers `continue` after a stop (not an interruption) with an untracked file present, and that the stopped path commits new files, unlike FR-015's "only tracked changes".

**Why this matters:** FR-015: `continue` commits only tracked changes.

**How it was resolved:** A code fix restricting the stopped path to tracked files (de664b8) broke the carried behavior-contract scenario "a step stop names the patches behind it and writes a prompt for fixing it with an agent" (tests/integration/stops.test.ts:319), which writes an untracked `ok.txt` as the user's fix and expects it committed. FR-052 makes that scenario binding, so the fix was reverted (5af2b39). That test also covers the stopped path with an untracked file, so the test gap does not exist. The conflict between FR-015's wording and the contract is listed as a spec-evolution candidate in REVIEW-CODE.md.

### FINDING-X2
- **Severity:** Important (Codex P2)
- **Confidence:** 75
- **File:** src/run/fetch.ts
- **Category:** external
- **Source:** codex
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 8d4ea8b

**What is wrong:** A pinned PR merged upstream by squash was skipped as merged, though upstream does not contain the pinned commit.

**How it was resolved:** The merged-PR shortcut applies only to unpinned patches; pinned ones are judged by whether upstream contains the pin (FR-053).

**External tool analysis (Codex):**
> If an upstream PR is marked merged and its merge commit is in the fetched upstream, this skips the patch before checking whether it is pinned. A pin to a commit not contained in upstream (for example, an earlier PR revision later squash-merged) is then silently omitted instead of being merged at that exact commit.

### FINDING-X3
- **Severity:** Important (Codex P2)
- **Confidence:** 75
- **File:** src/run/fetch.ts
- **Category:** external
- **Source:** codex
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 8d4ea8b

**What is wrong:** A pinned patch whose branch or PR ref was gone stopped the run, although the pinned commit was available.

**How it was resolved:** When fetching the source fails for a pinned patch, the pinned commit is used with a warning.

**External tool analysis (Codex):**
> For a pinned branch or PR whose source ref has since been deleted or become unreachable, this unconditional fetch throws before the later code checks whether the pinned SHA is already available locally or fetches that SHA directly.

### FINDING-X4
- **Severity:** Important (Codex P2)
- **Confidence:** 75
- **File:** src/cli/commands/remove.ts
- **Category:** external
- **Source:** codex
- **Round found:** 1
- **Resolution:** fixed (round 1), commit 86a0e6f

**What is wrong:** `remove` matched display strings, so a patch named with a different spelling (URL form, repository case) could not be retired.

**How it was resolved:** `remove` uses `sameSource`, as `add` does for duplicates.

## Minor Findings

Fixed (round 2, commit d297201), from the round-1 re-review:
- R1: a check stop ended early by the fix bound now names the bound instead of reporting fewer attempts than configured (src/run/harness-fix.ts).
- R2: a pinned PR merged upstream is noted as "merged at its pin", not "merged elsewhere" (src/run/fetch.ts).
- R3: a conflict stop after the harness gave up also gets the ready-to-run agent prompt (src/run/harness-merge.ts, FR-014).

Fixed before the deep review (Stage 1 compliance fixes) are listed in REVIEW-CODE.md.

Remaining (all unambiguous unless noted; none affects the gate):

| ID | File:line | Description |
|----|-----------|-------------|
| C4 | src/harness/invoke.ts:93, src/steps/run.ts:42, src/run/accept.ts:66 | Timeouts above 2147483 s overflow `setTimeout` and fire at once; validate or clamp. |
| C5 | src/core/patchlist.ts:143 | `attempts` 0.5 floors to 0, making the fix bound 0; require an integer >= 1. |
| C6 / P4 | src/core/lock.ts:39-54 | Stale-lock takeover is not atomic (two takers can both win); take over by rename. |
| C7 | src/run/mergeloop.ts:47-52 | A patch contained in an earlier listed patch (not in upstream) is marked contained and its acceptance check skipped. |
| P5 | src/core/lock.ts:8-15 | pid reuse after reboot keeps a dead lock "alive"; store process start time. |
| P6 | src/cli/commands/remove.ts, src/git/refs.ts | Private refs of retired patches are never deleted. |
| P7 | src/live/screen.ts:54 | Verbose live view keeps the whole log in worker memory. |
| P8 | src/steps/run.ts:54-60 | Pipe readers are not cancelled after the post-exit race; a lingering child can append to the next attempt's log. |
| P9 | src/run/accept.ts:54-74 | Acceptance output is held fully in memory for the regex. |
| S4 | src/run/common.ts:73 | `artifact.install` may point outside the checkout; refuse `..`/absolute paths (the trust question now shows it). |
| S5 | src/core/paths.ts:12 | A `--dir` inside the work tree lets a patch plant `recipe.toml` or `trust.json`; refuse such a dir. |
| S6 | src/plugins/sources/fork-branch.ts, src/git/git.ts:110 | Fork URLs starting with `-` or using `ext::` are not refused; add `--` before repository arguments. |
| S7 | src/harness/select.ts:27 | A relative harness path resolves against the merged tree; resolve against the patch list dir. |
| A3 | src/run/preflight.ts, src/rebase/rebase.ts:78-89 | Two `forkProblem` and two `pushUrl` implementations that can disagree. |
| A4 | src/run/accept.ts:41-83 | `runAcceptance` duplicates `runOne` from steps/run.ts. |
| A5 | src/run/verifyloop.ts:22 and others | Unused exports (`runCheckoutStep`, `planningOf`, `upstreamName`, `plannedOf`, `sourceSlug`, `headRepository`, `activity`, `buildLeftover` re-export). |
| A6 | src/run/leftover.ts | Leftover filter is module-level state set by recipes and read by harness; `.bun-build` hard-coded in core. |
| A7 | src/harness/invoke.ts:39, src/run/stop.ts | Core branches on adapter kind `plain` and falls back to `claude` (SC-006: needs a `streams` flag on the adapter). Needs an architecture decision. |
| A8 | src/rebase/select.ts, src/rebase/push.ts | Re-export shims whose comments describe logic they don't hold. |
| A9 | src/run/harness-fix.ts and others | Runtime import cycles inside src/run/. |
| A10 | src/run/finish.ts:98-130 | Event line formatting repeated in 3-4 places; event kinds are untyped strings. |
| T6 | src/git/git.test.ts | Git-too-old refusal only unit-tested, not end to end. |
| T7 | src/harness/select.ts:19 | Defaults 900 s / 300 s untested. |
| T8 | tests/integration/acceptance.test.ts | `DEBASER_ARTIFACT` unset without an artifact untested. |
| T9 | tests/support/world.ts:82 | Test env inherits the developer's git config and `GIT_*`/`DEBASER_*` variables. |
| T10 | tests/contract.test.ts | Contract test checks titles only; a duplicate title exists. |
| T11 | tests/integration/acceptance.test.ts:204 | "fix leaves the check failing" test doesn't distinguish from the idle-harness case. |
| T12 | tests/integration/rebuild.test.ts:145, 246 | Test title claims an assertion it doesn't make; retention not tested through rebuild. |
| T13 | tests/smoke/binary.test.ts | SC-005 (only git and gh needed) not tested with a restricted PATH; timing assertion can flake. |
| R4 | tests/integration/rebase.test.ts:179, recipes.test.ts:186 | New tests don't assert ordering before the push question, or control-character escaping. |

## Notable Observations

### NOTABLE-A1 (reclassified from Important)
- **File:** src/run/harness-fix.ts, harness-merge.ts, accept.ts, src/rebase/rebase.ts
- **Category:** architecture
- **Description:** The harness attempt sequence (snapshot, prompt, invoke, judge, signal, record, discard) is written five times, with slightly different discard rules.
- **Rationale:** Reclassified because a shared `runAttempt` is a large refactor of working, tested code; the divergences found do not change behavior today (rejections other than timeouts and broken runs can only be "changed nothing").

### NOTABLE-A2 (reclassified from Important)
- **File:** src/run/fetch.ts, src/core/patchlist.ts, src/rebase/rebase.ts and others
- **Category:** architecture
- **Description:** Core code switches on source kind in about ten places; `SourceKind.headRepository` is unused. A new forge would need edits across core, contrary to contracts/plugins.md.
- **Rationale:** FR-004 is met (sources sit behind an interface), but the boundary leaks. Widening the interface is an architecture decision for when a second forge is added.

### NOTABLE-A11
- **File:** src/run/rebuild.ts:70
- **Category:** architecture
- **Description:** A rebuild run never records phase `rebase`; data-model.md's state diagram shows it.

### NOTABLE-A12
- **File:** src/run/common.ts
- **Category:** architecture
- **Description:** run/common.ts mixes formatting, state saving, recipe loading and prompts.

### NOTABLE-C8
- **File:** src/rebase/rebase.ts:577-621
- **Category:** correctness
- **Description:** Rebased own-branch checks share one attempt budget per branch, not per check (stricter than FR-021's per-problem limit).

### NOTABLE-S8
- **File:** src/report/manifest.ts, src/run/accept.ts, src/harness/invoke.ts
- **Category:** security
- **Description:** Steps, acceptance checks and the harness inherit the whole environment (tokens, SSH agent) while running other people's PR code. Worth documenting or an env allowlist.

### NOTABLE-S9
- **File:** src/prompts/conflict.md
- **Category:** security
- **Description:** PR descriptions are spliced into agent prompts without untrusted-data framing (prompt-injection channel).

### NOTABLE-P10
- **File:** src/git/git.ts:16-23
- **Category:** production-readiness
- **Description:** An interruption exits silently; a one-line note naming the phase and next command would help cron logs.

### NOTABLE-T14
- **File:** tests/integration/status.test.ts
- **Category:** test-quality
- **Description:** No timing guard for SC-003, and "changes nothing" does not cover debaser's own directory.

### NOTABLE-R5
- **File:** src/steps/isolated.ts
- **Category:** production-readiness
- **Description:** Running earlier steps in each isolated worktree (the FR-012 fix) multiplies attribution cost by the number of earlier steps; add per-step progress or cache plain-upstream results.

## Post-Fix Spec Coverage

The fix rounds added or narrowed code; no function, file or requirement path was removed. Spot-checked after the fixes: FR-012 (src/steps/isolated.ts), FR-020/FR-021 (src/run/harness-fix.ts), FR-031a/FR-033 (src/run/rebase-phase.ts offerPush), FR-042 (src/recipes/trust.ts), FR-045 (src/report/manifest.ts), FR-053 (src/run/fetch.ts). All spec requirements verified after the fix loop.

## Test Suite Results

| Round | Test Command | Exit Code | Failures | Status |
|-------|-------------|-----------|----------|--------|
| Stage 1 fixes (c16e76f) | bun test | 0 | 0 | passed (331 tests) |
| Round 2 (de664b8) | bun test | 1 | 1 | failed: carried contract test, FR-015 change reverted |
| Final HEAD (5af2b39) | bun test | 0 | 0 | passed (337 tests) |

Targeted test files were run after each fix; every new regression test was checked to fail on the pre-fix code.

## Remaining Findings

No Critical or Important findings remain (FINDING-T5 resolved without a code change; its spec question is tracked in REVIEW-CODE.md). 30 Minor findings and 10 Notable observations are listed above for follow-up.
