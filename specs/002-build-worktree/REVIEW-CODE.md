# Code Review: Dedicated build worktree and visible configuration

**Spec:** specs/002-build-worktree/spec.md
**Date:** 2026-11-23
**Reviewer:** Claude (speckit.spex-gates.review-code, with spex-deep-review)
**Branch:** 002-build-worktree (reviewed against main)

## Compliance Summary

**Overall Score: 100%** (39/39 checks after the Stage 1 fix; 97.4% before it)

| Area | Score |
|------|-------|
| Functional requirements (FR-001 to FR-022) | 22/22 (100%) |
| Edge cases (11) | 11/11 (100%) |
| Success criteria (SC-001 to SC-006) | 6/6 (100%) |
| Spec-declared constants | none declared (check skipped) |

Acceptance scenarios (US1 to US5, 16) were traced through the FRs they exercise and the integration tests in tests/integration/tree.test.ts and config.test.ts.

### Deviations found and fixed in Stage 1

| Requirement | Issue | Commit |
|-------------|-------|--------|
| FR-017 | `list` and `status` showed the patch list's path but not the data directory as its own entry | 192d94b |

### Deviations remaining (spec evolution candidates)

None.

### Extra features (not in spec)

- `status` lists up to ten modified files of the build directory under its header. Helpful, in the spirit of FR-022.
- A locked, absent build directory is refused with a `git worktree unlock` hint (added in the deep review fix loop, from FR-008).
- A passed install leaves a `debaser-installed` stamp in the worktree's git directory (added in the fix loop, from FR-010).

## Code Review Guide

Where a human reviewer should look first:

1. **src/core/tree.ts**: the build directory. `treePath` (recorded or default path), `inspect` (read-only state for `status`/`list`), `prepare` (FR-007 refusals, creation, recording; every refusal comes before any change), `runTree` (which worktree a stopped run continues in, including FR-014 legacy runs).
2. **`ctx.repo` vs `ctx.home`** (src/core/context.ts): `home` is where debaser was started; `repo` is reassigned to the build directory by `build` (src/run/build.ts), `continue` (src/run/resume.ts) and `rollback` (src/run/rollback.ts). All unchanged run code reads `ctx.repo`, so it now runs in the build directory.
3. **src/run/rollback.ts**: three paths. A stopped run in its build directory; a stopped run whose directory is gone (`withoutTree`, refs only); no run (`restorePrevious`, `-prev` backups with the same refusals as a build).
4. **src/git/worktree.ts, src/git/git.ts**: porcelain parsing (`worktree list`, `status -z`), `removeWorktree`'s fallback (never drops a locked or present registration), and lock-free `status`.
5. **src/steps/install.ts**: the install decision with the per-worktree stamp (FR-010, SC-004).
6. **Display** (src/views/config.ts, src/views/recipe.ts, src/cli/commands/{list,status,recipe}.ts): the three header lines, layer sources, JSON fields.
7. **Tests**: tests/support/world.ts now records `tree: "."` in `configure`, so older suites build in place (US5); the sibling build directory is covered by tests/integration/tree.test.ts and config.test.ts through `configureTree`.

## Deep Review Report

**Gate: PASS** (after fix round 2)

### Review agents

| Agent | Found | Fixed | Remaining | Status |
|-------|-------|-------|-----------|--------|
| Correctness | 4 | 2 | 2 (1 Minor, 1 Notable) | completed |
| Architecture & Idioms | 13 | 3 | 10 (8 Minor, 2 Notable) | completed |
| Security | 4 | 2 | 2 (1 Minor, 1 Notable) | completed |
| Production Readiness | 5 | 3 | 2 (2 Notable) | completed |
| Test Quality | 7 | 4 | 3 (3 Minor) | completed |
| Goal Alignment | 0 | 0 | 0 | skipped (no PR for the branch) |
| Re-review (round 1 diff) | 5 | 5 | 0 | completed |
| Re-review (round 2 diff) | 2 | 1 | 1 (1 Notable) | completed |
| CodeRabbit (external) | 2 | 2 | 0 | completed (`coderabbit review --agent --committed --base main`) |
| Copilot (external) | 0 | 0 | 0 | skipped (disabled in config, CLI not installed) |
| Codex (external) | 0 | 0 | 0 | completed (`codex review --base main`, no actionable defects) |
| Test Suite (regression) | 0 | 0 | 0 | passed (see Test results) |

Per-agent counts include duplicates. After deduplication: 0 Critical, 6 Important (6 fixed), 27 Minor (14 fixed, 13 remaining), 7 Notable.

MVP: Architecture & Idioms (13 findings)

### Key fixes applied

1. A new build directory installs dependencies even when the recipe has triggers but no marker, including after a first build that failed before its install; tracked by a stamp in the worktree's git directory (correctness, round 1 re-review)
2. Locked or still-present worktree registrations are never dropped; a locked, absent build directory is refused by `build` and `rollback` (security)
3. `status` and `list` read the build directory with `git --no-optional-locks status`, so they never race a running build for the index lock (production)
4. `modifiedFiles` parses `-z` porcelain (unquoted names, renames in either column) and fails instead of answering "clean" (CodeRabbit, architecture, production, correctness)
5. A no-run rollback no longer points `ctx.repo` at a directory that may not exist (architecture)
6. An existing but unrecorded default build directory is recorded on the next run (production, FR-003)
7. Shell hints quote paths (security, re-review); dead `worktreeWith` removed (architecture); README states when the started-from checkout is touched (CodeRabbit)
8. Tests: FR-014 legacy runs resumed and rolled back from another worktree, rollback of the installed artifact in the build directory, a stricter checkout-state helper (contents and ignored files), locked-directory refusals, failing `git status`, install in new/recreated/failed-first-build directories (test quality)

### Remaining findings

No Critical or Important findings remain. 13 Minor findings (worktree-list parser consolidation, path comparison styles, state shared between header and JSON, a legacy-run rollback corner, and additional edge-case tests) and 7 Notable observations are listed with file:line in review-findings.md.

### Post-fix spec coverage

The fix loop removed only dead code (`worktreeWith`) and its own round 1 flag (`freshTree`, replaced by the install stamp). FR-003, FR-007, FR-008, FR-009, FR-010, FR-013, FR-014, FR-016, FR-017 and FR-022 were rechecked against code and tests. All spec requirements verified after the fix loop.

### Test results

- Typecheck (`bun run typecheck`): passes at final HEAD.
- Full suite after fix round 1 (c59241c): 386 pass, 0 fail (1041 s).
- Full suite at final HEAD (fix round 2 plus the work-tree rename test): 388 pass, 0 fail across 37 files (1195 s).
- An earlier round 2 run was cut off by a network outage and machine pause (3 tests reported after 30 to 87 minutes each, exit 143); the clean rerun above replaces it.

## Next Steps

Code review complete. To close out this feature:
  1. /speckit-spex-walkthrough   (try the feature with a runbook)
  2. /clear                      (free context for final gate)
  3. /speckit-spex-finish         (verify + merge/PR, all-in-one)
