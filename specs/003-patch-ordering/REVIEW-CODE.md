# Code Review: Managing the order of patches

**Spec:** specs/003-patch-ordering/spec.md
**Date:** 2026-11-26
**Reviewer:** Claude (speckit.spex-gates.review-code)

## Compliance Summary

**Overall Score: 100%**

- Functional Requirements: 29/29 (100%)
- Acceptance scenarios (US1 to US5): 34/34 (100%)
- Edge Cases: 9/9 (100%)
- Success Criteria: 6/6 (100%)

## Functional Requirements

| FR | Implementation | Status | Notes |
|----|----------------|--------|-------|
| FR-001 | src/core/order.ts `resolveRef` | Compliant | Position or any `remove` source spelling |
| FR-002 | src/core/order.ts `resolveRef` | Compliant | Bare digits are positions; "out of range 1..N" / "not in the list" |
| FR-003 | src/cli/commands/add.ts, `insertAt` | Compliant | Mutually exclusive, appends without options |
| FR-004 | src/cli/commands/add.ts + `ordered` | Compliant | New patch shown as `>N` |
| FR-005 | src/cli/commands/move.ts `run`, `place` | Compliant | |
| FR-006 | src/cli/commands/move.ts `checkOptions`, `place` | Compliant | All listed combinations are usage errors |
| FR-007 | move.ts `sameOrder` check | Compliant | "the order is unchanged", no save |
| FR-008 | move.ts, `ordered`, views/list.ts `marked` | Compliant | |
| FR-009 | move.ts `interactive` | Compliant | |
| FR-010 | move.ts `interactive` (`number`, y/yes regex) | Compliant | |
| FR-011 | move.ts `interactive` | Compliant | Copy of the list, one save at the end; EOF throws before saving |
| FR-012 | move.ts `interactive` (`Usage` without `ask`) | Compliant | Hint names both command-line forms |
| FR-013 | src/run/propose.ts, src/git/merge.ts `mergeOnto` | Compliant | merge-tree + commit-tree only; no rerere |
| FR-014 | propose.ts `computeProposal` | Compliant | Upstream-alone conflicts become fixed patches |
| FR-015 | src/core/order.ts `propose` | Compliant | Priority-ordered constraints, cycle drop, Kahn's sort by current index |
| FR-016 | propose.ts `conflicts`, order.ts `settle` | Compliant | |
| FR-017 | src/views/propose.ts `render` | Compliant | Also shown when the current order is kept |
| FR-018 | move.ts `proposed` | Compliant | Prints `next: debaser build`, never builds |
| FR-019 | move.ts `proposed` | Compliant | |
| FR-020 | propose.ts `commits` | Compliant | Missing commits refused with `--fetch` hint; skips merged/contained |
| FR-021 | src/run/known.ts, propose.ts | Compliant | Pin first, then local tip |
| FR-022 | src/core/guard.ts, src/core/lock.ts | Compliant | |
| FR-023 | src/cli/main.ts (`move` in `locking`), list reload in move/add | Compliant | |
| FR-024 | src/report/order-note.ts, src/run/build.ts | Compliant | |
| FR-025 | move.ts | Compliant | No harness, push or build calls |
| FR-026 | package.json unchanged; line prompts | Compliant | |
| FR-027 | src/cli/usage.ts, README.md | Compliant | |
| FR-028 | Explained/Usage exit 1; outcomes exit 0 | Compliant | |
| FR-029 | src/cli/commands/status.ts | Compliant | Only a refactor to `knownCommits` |

## Observations (non-blocking)

- Patches that shift up as a side effect of another patch moving after them get no reason line of their own; the spec example ("#5 moved after #2") reads as reasons for patches that move after others, so this is treated as compliant. (Patches moved behind a later one through a chain of constraints did lack a reason; fixed in the deep review, FINDING-8.)
- End of input at "Apply this order?" is treated as a decline (exit 0). FR-028's exit 1 on end of input is stated for the interactive move session only.

## Extra Features (Not in Spec)

- The proposal lists patches skipped as already in upstream in their own section. Helpful, consistent with FR-020.

## Spec-Declared Constants

The spec has no `## Constants` section; check skipped.

## Deep Review Report

**Gate: PASS** (after fix round 1, plus one follow-up fix from the re-review)
Details: specs/003-patch-ordering/review-findings.md

| Agent | Found | Fixed | Remaining | Status |
|-------|-------|-------|-----------|--------|
| Correctness | 3 | 2 | 1 (Notable) | completed |
| Architecture & Idioms | 8 | 7 | 1 (Notable) | completed |
| Security | 1 | 1 | 0 | completed |
| Production Readiness | 4 | 4 | 0 | completed |
| Test Quality | 7 | 4 | 3 (2 Minor, 1 Notable) | completed |
| Goal Alignment | 0 | 0 | 0 | skipped (no PR) |
| CodeRabbit (external) | 1 | 1 | 0 | completed (re-review: 0 findings) |
| Copilot (external) | 0 | 0 | 0 | skipped (disabled in config) |
| Codex (external) | 1 | 1 | 0 | completed |
| Re-review (round 1) | 1 | 1 | 0 | completed |
| Test Suite (regression) | 0 | 0 | 0 | passed |
| **Total (before dedup)** | **26** | **21** | **5** | |

After deduplication: 1 Critical, 6 Important, 15 Minor, 3 Notable. All Critical and Important findings are fixed; 2 Minor test gaps and 3 Notable observations remain.

### Key fixes

1. `move`'s prompts read answers through a non-blocking readline reader: Enter now ends the session and saves (it used to discard it with exit 1), and Ctrl-C or a kill at a prompt exits 130/143 at once with the list unchanged. Verified on a real pty. (production-readiness)
2. `move --propose --fetch` fetches patches the way `build` does (own branches only on origin, pinned branches), while own branches with a local copy stay at their local tip. (Codex, correctness)
3. A pinned PR is no longer skipped by an old `skipped-merged` report entry. (CodeRabbit)
4. The stopped-run refusal reuses `inProgress`; the newest-build-report walk is shared by the order note, the proposal and `status`, and ignores malformed entries. (architecture, security)
5. `main` reloads the patch list after taking the run lock for every locking command. (production-readiness)
6. Patches moved through a chain of constraints get a reason line; the proposal prints progress lines. (correctness, production-readiness)
7. New tests: the kept-current path with `--yes`, the line reader, refusal before any merge test, the lock held at every prompt, and the merged-upstream skip with its pinned exception. (test-quality)

### Remaining (Minor)

- Conflict counts in fixtures never exceed 1, so a verification loop that stopped at the first conflict would pass (src/run/propose.ts).
- The SC-005 snapshot runs against an empty `rr-cache` and a clean checkout (tests/integration/order.test.ts).

### Post-fix spec coverage

29/29 functional requirements verified after the fix loop.

### Verification

- `bun run typecheck`: clean.
- Full `bun test`: 438 pass, 0 fail, 1 skipped (opt-in SC-004 perf test), 439 tests across 44 files.
- Targeted rerun after the last fix (order, move, lines, order-note, status): 50 pass, 0 fail.
