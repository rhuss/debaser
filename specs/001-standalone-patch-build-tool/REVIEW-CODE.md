# Code Review: debaser v1, a standalone tool for patched builds

**Spec:** specs/001-standalone-patch-build-tool/spec.md
**Date:** 2026-11-21
**Reviewer:** Claude (speckit.spex-gates.review-code, with spex-deep-review)
**Branch:** 001-standalone-patch-build-tool (reviewed against main)

## Compliance Summary

**Overall Score: 96.5%** (123.5/128 checks; partial = half)

| Area | Score |
|------|-------|
| Functional requirements (FR-001 to FR-054, 59 items) | 56/59 (94.9%) |
| Edge cases (17) | 17/17 (100%) |
| Acceptance scenarios (US1 to US8, 52) | 50.5/52 (97.1%) |
| Spec-declared constants | none declared (check skipped) |

Before the Stage 1 fixes the functional score was about 82% (14 of 59 requirements partial or deviating). Every deviation with an unambiguous fix was fixed and tested. The ones left need a product or spec decision.

### Deviations found and fixed in Stage 1

| Requirement | Issue | Commit |
|-------------|-------|--------|
| FR-012 | Plain-upstream rerun skipped the steps before the failing one, so a step needing a native build was blamed on upstream (exit 4) | e5ecc0f |
| FR-036 | `status` lost the last build's check and acceptance results after any `rebase` run | 19216a1 |
| FR-021 | Total fix bound could be overshot inside one problem's attempts | 620e9d3 |
| US3-5 | `continue` after an acceptance stop with exit 5 never asked the harness again | 15d8992 |
| FR-042, FR-054 | `rebase --trust-recipe` was ignored | 021b304 |
| FR-042 | The binary showed "was not trusted" instead of the `--trust-recipe` hint off a terminal | dc65619 |
| FR-048 | Trust prompt wait counted as run time | 8273f74 |
| FR-053 | A pinned branch took the rebased tip when an own PR rebased the same branch | eae6230 |
| Edge (gh missing) | No warning when `gh` could not answer for a PR | 3bbb88f |
| FR-031a | Harness fixes on rebased branches were shown only after the push question | 9659436 |
| Edge (git too old) | Version checked only by `rebuild` and `rebase` | 31ac755 |
| FR-031a, Edge (split origin) | Rebuild read own branches from origin's fetch URL instead of its push URL | 4c1e28d |
| FR-014 | Conflict stops had no ready-to-run agent prompt | 3959ab4 |
| FR-043 | Misspelt parser names silently fell back to the generic scan | dc04d69 |
| FR-028 | Shared decoder could garble multi-byte output across stdout and stderr | d766c92 |
| US6-4 | `status --json` dropped the own-branch rebase detail | c16e76f |

### Deviations remaining (spec evolution candidates)

All of these conflict with a carried-over behavior-contract scenario or need a design choice. None has an unambiguous code fix.

| Requirement | Code | Deviation | Decision needed |
|-------------|------|-----------|-----------------|
| FR-015 | src/run/resume.ts:94-131 | After a stop, `continue` commits new untracked files as part of the user's fix; FR-015 says only tracked changes. The carried contract scenario "a step stop names the patches behind it..." (tests/integration/stops.test.ts:319) relies on it, so a fix attempt (de664b8) was reverted (5af2b39) | Spec: scope "only tracked changes" to interrupted steps (as US2-7 does), or change the contract |
| FR-014 | src/run/stop.ts:50 | Exit-4 stops (upstream broken) don't offer `continue`; the carried contract test asserts this | Product: drop "MUST offer continue" for exit 4, or offer it |
| FR-026 | src/steps/attribute.ts:43-47, src/report/handoff.ts:118-135 | Patches that clash only at build time get a `build-clash` handoff file, not a note; handoffs.test.ts expects the file | Spec or code: note vs handoff for build clashes |
| FR-027 | src/steps/attribute.ts:27 | Attribution candidates also include files the agent fix touched, beyond the failure's implicated paths | Spec: allow fix files as candidates, or narrow the code |
| FR-045 | src/report/manifest.ts:47-50, src/steps/isolated.ts | Isolated and rebase checks get `DEBASER_PATCHES`/`DEBASER_MANIFEST` describing the integration build, not the tree checked | Design: what manifest a single-patch or upstream-only tree gets |
| FR-048 | src/run/finish.ts, src/run/rollback.ts | A stopped run that is rolled back is never recorded in timings; the carried contract test pins this | Product: record rolled-back runs as partial, or relax FR-048 |
| US3-5 | src/harness/verify.ts:48 | A harness that exits non-zero stops after the first broken attempt instead of using all attempts (documented in docs/harness.md) | Spec or code |
| US7-4 vs FR-027 | src/plugins/parsers/registry.ts:16 | Steps without a parser still get path-based blame through the generic log scan; US7-4 says "without implicated-patch detection" | Spec text contradicts itself |

### Extra features (not in spec)

- `rebase --skip-branch` as an alias for `continue --skip-branch` (src/cli/commands/rebase.ts). Helpful; candidate for the spec.
- `leftovers` recipe key (data-model.md documents it; the spec does not). Helpful.

## Code Review Guide

Where a human reviewer should look first:

1. **Run loop and recovery** (src/run/): rebuild.ts → rebase-phase.ts → mergeloop.ts → verifyloop.ts → accept.ts → finish.ts, plus stop.ts, resume.ts and rollback.ts. State lives in run.json (src/core/runstate.ts). Interrupt cleanups (src/git/git.ts `onInterrupt`) now run newest first.
2. **Agent verification** (src/harness/verify.ts, src/run/harness-*.ts): what counts as an accepted conflict resolution or fix, the per-problem attempts and the total fix bound (FR-019 to FR-022).
3. **Trust boundary** (src/recipes/trust.ts, load.ts): the project-repo recipe is read only at the fetched upstream tip and fingerprinted together with the prompt files it names.
4. **Own-branch rebasing** (src/rebase/rebase.ts, 840 lines): ownership, leases, in-worktree mode and harness fixes on rebased branches.
5. **Tests** (tests/support/world.ts builds bare-repo worlds with stubbed gh and harnesses; tests/integration/*). docs/behavior-contract.md maps the reference suite to these tests.

## Deep Review Report

**Gate: PASS** (after fix round 2)

### Review agents

| Agent | Found | Fixed | Remaining | Status |
|-------|-------|-------|-----------|--------|
| Correctness | 8 | 3 | 5 (4 Minor, 1 Notable) | completed |
| Architecture & Idioms | 12 | 0 | 12 (8 Minor, 4 Notable; 2 reclassified from Important) | completed |
| Security | 9 | 3 | 6 (4 Minor, 2 Notable) | completed |
| Production Readiness | 10 | 3 | 7 (6 Minor incl. 1 duplicate, 1 Notable) | completed |
| Test Quality | 14 | 4 (+1 resolved without code change) | 9 (8 Minor, 1 Notable) | completed |
| Goal Alignment | 0 | 0 | 0 | skipped (no PR for the branch) |
| Re-review (round 1 diff) | 5 | 3 | 2 (1 Minor, 1 Notable) | completed |
| CodeRabbit (external) | 0 | 0 | 0 | completed (`coderabbit review --agent --base main`) |
| Copilot (external) | 0 | 0 | 0 | skipped (disabled in config, CLI not installed) |
| Codex (external) | 4 | 4 | 0 | completed (`codex review --base main`; 1 duplicate of a correctness finding) |
| Test Suite (regression) | 1 | 1 | 0 | 1 failure at de664b8 (reverted); final run passed |

After deduplication: 0 Critical, 17 Important (16 fixed, 1 resolved as covered with its behavior question moved to spec evolution), 33 Minor (3 fixed, 30 remaining), 10 Notable.

MVP: Test Quality (14 findings)

### Key fixes applied

1. Harness fixes are judged after rerunning the earlier steps, as FR-020 requires (correctness)
2. Interrupted in-worktree rebases are undone during `rebuild` and on `continue` (correctness, codex)
3. Trust fingerprint covers the prompt files a project recipe names; the trust question escapes control characters and lists install path and prompts (security)
4. Credentials are stripped from the fork URL in manifest.json and DEBASER_FORK_URL (security)
5. Network git and gh calls are bounded in time and never prompt; gh answers cached per command (production)
6. Throwaway worktrees are removed on interrupt (production)
7. The FR-015 test gap turned out to be covered by a carried contract test; the behavior question went to spec evolution (test quality)
8. Pinned patches survive a deleted source and a squash-merged PR; `remove` matches any spelling of a source (codex)
9. Tests: rejection reasons asserted, exit codes 129/143, install-step skipping, test scratch cleanup, regression tests for every fix (test quality)
10. Fix-bound stop message, pinned-PR note, and agent prompt on harness-exhausted conflict stops (re-review)

### Remaining findings

No Critical or Important findings remain. 30 Minor findings and 10 Notable observations are listed with file:line in review-findings.md. The two that need an architecture decision, not just a code change: harness adapter streaming flag and SC-006 (A7), and the source-kind plugin boundary (Notable A2).

### Post-fix spec coverage

The fixes added or narrowed code. No requirement path was removed, and the FRs touched by the fixes were rechecked. All spec requirements verified after the fix loop.

### Test results

- Typecheck (`bun run typecheck`): passes at final HEAD.
- Build (`bun run build`): passes at final HEAD.
- Full suite (`bun test`) after the Stage 1 fixes (c16e76f): 331 pass, 0 fail.
- Full suite at final HEAD (5af2b39): 337 pass, 0 fail (6277 expect() calls). An intermediate run at de664b8 had 1 failure (a carried contract test), which led to the FR-015 revert.

## Next Steps

Code review complete. To close out this feature:
  1. /speckit-spex-walkthrough   (try the feature with a runbook)
  2. /clear                      (free context for final gate)
  3. /speckit-spex-finish         (verify + merge/PR, all-in-one)

Resolve the eight spec-evolution candidates above with `speckit-spex-evolve` before or during finish.
