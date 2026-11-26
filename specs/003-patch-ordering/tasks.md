# Tasks: Managing the order of patches

**Input**: Design documents from `specs/003-patch-ordering/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli.md, quickstart.md

**Tests**: Included. Every user story in spec.md has an Independent Test, and the project tests every command on real repositories (`tests/integration/`, `tests/support/world.ts`, `run(w, ...args)`). Unit tests sit next to sources (`src/**/*.test.ts`).

**Shared test file**: `tests/integration/order.test.ts` collects the integration tests of all stories; tasks that add tests to it are sequential, not [P].

**Interfaces and constraints**: every task uses the names and signatures in plan.md "Interfaces" and inherits plan.md "Global Constraints"; the plan's "Review Focus" lists the extra inputs each test task pins.

## Phase 1: Setup

- [X] T001 Add the option fields `after: string | null`, `before: string | null`, `propose: boolean`, `yes: boolean` to `Options` and to `reader` in `src/cli/commands/index.ts` (read with `option(args, "after")`, `option(args, "before")`, `flag(args, "propose")`, `flag(args, "yes")`); let `add` accept `after` and `before`
- [X] T002 Create `tests/integration/order.test.ts` with the imports and `setDefaultTimeout(120_000)` used by `tests/integration/patchlist.test.ts`, and a helper that configures a world with N upstream PR patches (`pullRequest`, `configure`) and returns the displays in list order

## Phase 2: Foundational (blocks all stories)

- [X] T003 Write unit tests in `src/core/order.test.ts` for reference resolution: `/^\d+$/` is a 1-based position ("position N is out of range 1..M" when outside), `#12`, `owner/repo#12`, URLs and branch names resolve as sources with `sameSource` ("<shown> is not in the list"), retired-only sources are "not in the list"; `0` and any position on an empty list are out of range
- [X] T004 Write unit tests in `src/core/order.test.ts` for placement: `after` puts the patch at index(ref)+1 and `before` at index(ref), both computed after removing the moved patch, moving down and up; moving relative to itself throws `Usage`; an unchanged result is detected; inserting a new patch with `after`/`before`; `moveTo` puts the patch at the given final index (0, last, and unchanged)
- [X] T005 Implement `src/core/order.ts`: `resolveRef(patches, arg, upstreamRepo): number` (FR-001, FR-002, data-model "PatchRef"), `place(patches, from, at)`, `moveTo(patches, from, to)`, `insertAt(patches, patch, at)`, `sameOrder(a, b)` with the `At` type (plan.md "Interfaces"); make T003 and T004 pass
- [X] T006 Implement `refuseWhileRunning(ctx)` in `src/core/guard.ts`: when `runstate.loadRun(ctx.dir)` returns state, throw `Explained` "a run is stopped (<kind> at <phase>); finish it with debaser continue or end it with debaser rollback" (FR-022); unit test in `src/core/guard.test.ts` with a written `run.json`
- [X] T007 Add marked rows to `render` in `src/views/list.ts`: option `marked?: Set<number>` (0-based indices); a marked row's `#` cell reads `>N` and is bold on a terminal (research R8); extend `src/views/list.test.ts` or add one if missing
- [X] T008 Add `move` to the `locking` set in `src/cli/main.ts` and register a `move` verb in `src/cli/commands/index.ts` (accepting `after`, `before`, `propose`, `yes`, `fetch`, one positional at most) backed by a new `src/cli/commands/move.ts` whose `run` first sets `ctx.list = patchlist.load(ctx.dir)` (the lock is held by then, FR-023) and throws `Usage` for unimplemented forms

**Checkpoint**: references, placement, the guard and marked lists work; stories can start.

## Phase 3: User Story 1 - Insert a new patch at a chosen place (P1)

**Goal**: `add <source> --after/--before <patch>` inserts instead of appending.
**Independent Test**: three patches, `add --after 1`, `add --before '#<pr of #1>'`, check `list` and `patches.json`.

- [X] T009 [US1] Add integration tests to `tests/integration/order.test.ts` for acceptance scenarios 1.1 to 1.5: insert after position 1 (printed list marks the new row with `>2`), insert before a source (`#N` is the PR), plain add still appends and prints no list, out-of-range reference refused with the range and `patches.json` byte-identical (exit 1), `--after` with `--before` is a usage error (exit 1), `--after` without a value is a usage error (exit 1)
- [X] T010 [US1] Implement position options in `src/cli/commands/add.ts`: both options → `Usage`; with one, call `refuseWhileRunning`, set `ctx.list = patchlist.load(ctx.dir)` before `bootstrap` reads it (FR-023), resolve the reference before any `gh` call, insert with `insertAt`, save, and print `added ...` followed by the list rendered with the new row marked (FR-003, FR-004); refusals are `Usage`/`Explained`, which `main` already maps to exit 1 (FR-028); without the options keep today's behavior exactly

## Phase 4: User Story 2 - Move a patch from the command line (P1)

**Goal**: `move <patch> --after|--before <patch>`.
**Independent Test**: four patches, `move 4 --after 1`, `move <source> --before <source>`, `move 2 --after 1` (unchanged), `move 2 --after 2` (usage).

- [X] T011 [US2] Add integration tests to `tests/integration/order.test.ts` for scenarios 2.1 to 2.5 plus: fewer than two patches prints `nothing to reorder` (exit 0); `--yes`/`--fetch` without `--propose`, `--propose` with a reference and `--propose` with `--after` are usage errors (FR-006); `move` with no patch list is refused (exit 1); an unchanged move leaves the `patches.json` mtime and bytes untouched (FR-007)
- [X] T012 [US2] Implement the command-line form in `src/cli/commands/move.ts`: validate option combinations (FR-006), then call `refuseWhileRunning` for every form before dispatching (so `--propose` and interactive refuse before any prompt or merge test, scenario 5.3), resolve both references, `place`, print `the order is unchanged` without saving when nothing changed (FR-007), else save and print the list with the moved row marked (FR-008); exit codes per FR-028

## Phase 5: User Story 5 - Safe reordering around runs and builds (P1)

**Goal**: refuse reordering during a stopped run or held lock; note order changes at build start.
**Independent Test**: stop a build at a conflict, try `move`, `move --propose`, `add --after`; hold the lock; reorder after a successful build and build twice.

- [X] T013 [US5] Add integration tests to `tests/integration/order.test.ts` for scenarios 5.1 to 5.3 and 5.5: with a stopped build (two conflicting patches, no harness) `move 1 --after 2`, `move --propose` and `add <src> --after 1` exit 1 naming `continue` and `rollback` and leave `patches.json` byte-identical; plain `add` and `remove` behave as before; with a lock file written for a live pid other than the test process (`process.ppid`, as `tests/integration/status.test.ts` does; `acquire` takes over its own pid) `move` and `add <src> --before 1` are refused naming the command
- [X] T014 [US5] Write unit tests in `src/report/order-note.test.ts`: reference order from the newest `result.json` with `command` build (or `rebuild`) and `outcome` success, `merged` patches only, in order; failed builds are skipped; no report → no note; added or retired patches alone → no note; a swapped pair → note
- [X] T015 [US5] Implement `lastBuildOrder(ctx)` and `orderChanged(ctx)` in `src/report/order-note.ts` using `reportDirs`, `paths.reports` and `sourceKey` (research R7)
- [X] T016 [US5] Print `note: the merge order changed since the last successful build; recorded conflict resolutions may not apply` through `ctx.progress` at the start of a new build in `src/run/build.ts` (not on `continue`) when `orderChanged(ctx)` (FR-024)
- [X] T017 [US5] Add an integration test to `tests/integration/order.test.ts` for scenario 5.4: successful build, `move`, build prints the note once; a further build prints none

## Phase 6: User Story 3 - Reorder interactively (P2)

**Goal**: plain `move` with numbered prompts and a loop.
**Independent Test**: scripted `io.ask` answers: two moves then `n`; interrupt in the middle; no terminal.

- [X] T018 [US3] Add integration tests to `tests/integration/order.test.ts` for scenarios 3.1 to 3.6 with a scripted `ask`: answers `4`,`1`,`n` reorder and save once; invalid answers (`0`, `9`, `x`) re-ask with the range; ` 2 ` is trimmed and accepted; empty first answer ends and saves earlier moves; `y`/`YES` continue, anything else ends (FR-010); `ask` returning null before the first answer and after one completed move both exit 1 with `patches.json` byte-identical; no `ask` → usage hint naming `move <patch> --after|--before <patch>` and `move --propose`
- [X] T019 [US3] Implement the interactive session in `src/cli/commands/move.ts` (FR-009 to FR-012): print the numbered list, ask `Move which patch? (1-N, Enter to finish)`, `To which position? (1-N)` (the final position), print the list with the moved row marked, ask `Move another patch? [y/N]`; work on a copy and save once at the end only if changed; null answer → `Explained` exit 1 without saving

## Phase 7: User Story 4 - Conflict-reducing proposal (P2)

**Goal**: `move --propose [--fetch] [--yes]`.
**Independent Test**: fixtures with a stacked pair listed in the wrong order and an own branch before a conflicting PR; accept; refs and build directory unchanged.

- [X] T020 [US4] Write unit tests in `src/core/order.test.ts` for `propose(names, participants, fixed, pairs)` and `settle(p, counts)` (research R4, R5, data-model "Constraint", "Proposal"): rule 1 puts the base first; rule 2 puts the own branch after; both-own and neither-own pairs keep order; a rule 1 cycle among three patches drops the later constraint and reports it unavoidable; non-conflicting patches keep relative order; fixed patches keep absolute indices; reasons name current positions and files; `settle` keeps the current order (`kept: true`, `proposed` = `current`) only when `counts.proposed > counts.current`, and keeps the proposal on equal or lower counts (FR-016)
- [X] T021 [US4] Implement `propose` and `settle` in `src/core/order.ts`: constraints in priority order (rule 1, then rule 2, each in current order of the moving patch), cycle check by reachability, stable Kahn sort by current position, fixed indices kept, reasons for violated accepted constraints, unavoidable list (FR-015, FR-017)
- [X] T022 [P] [US4] Add `mergeOnto(cwd, base, ref): { clean: boolean; files: string[]; commit?: string }` to `src/git/merge.ts` (built on `mergeTreeCheck`, which pair tests keep using directly): `merge-tree --write-tree` and, when clean, `commit-tree <tree> -p base -p ref` with `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` set to `debaser` (research R1); unit test in `src/git/git.test.ts` on a temporary repository that also checks `git for-each-ref` output is unchanged
- [X] T023 [P] [US4] Move `knownRefs` from `src/cli/commands/status.ts` to `knownCommits(ctx)` in `src/run/known.ts` (pin, own branch local then `origin`, private ref) and use it from `status.ts`; status tests stay green
- [X] T024 [P] [US4] Narrow `fetchPatch`'s `run` parameter in `src/run/fetch.ts` to `FetchRun = { upstream: { tip: string }; events: Event[] }` and `event`'s first parameter in `src/run/common.ts` to `{ events: Event[] }` (what they use); callers unchanged, `bun run typecheck` green
- [X] T025 [US4] Implement `computeProposal(ctx, { fetch })` in `src/run/propose.ts` (research R2, R3, R5): with `fetch`, fetch upstream (`git.fetchRemote`) and each non-own patch (`fetchPatch`); else resolve upstream from `refs/remotes/<remote>/<branch>` and patches via `knownCommits`, refusing with the unfetched names and a `--fetch` hint (FR-020); mark skipped (ancestor of upstream, or `skipped-merged` in the newest build report), single tests with `mergeOnto`, pair tests with `mergeTreeCheck` on the single tests' synthetic commits, `propose`, verify current and proposed sequences with `mergeOnto` (conflicting patch counted and left out, FR-016), then `settle`
- [X] T026 [US4] Implement `render(p, names, { color })` in `src/views/propose.ts`: header noting only merge conflicts were tested, CURRENT/PROPOSED columns, `moved:` reasons, `conflicts no order avoids (the next build hands them to the harness):`, `conflicts with upstream alone:`, skipped patches, and `conflicts: current order N, proposed order M` (contracts/cli.md "Proposal")
- [X] T027 [US4] Wire `--propose` into `src/cli/commands/move.ts`: guard, nothing-to-reorder, `computeProposal`, render; same order → `the current order is already the best order found`; kept current → say so; on a terminal ask `Apply this order? [y/N]`; off a terminal without `--yes` print `run debaser move --propose --yes to apply it`; on apply save, print the marked list and `next: debaser build` (FR-018, FR-019); never call the harness, push or build (FR-025)
- [X] T028 [US4] Add integration tests to `tests/integration/order.test.ts` for scenarios 4.1 to 4.10 using `branch`, `pullRequest` and `ownPullRequest` fixtures: stacked pair reordered with a "builds on" reason; own branch moved after a conflicting PR with files named and listed unavoidable; two PRs conflicting both ways keep order; identical order message; decline leaves the list; upstream-only conflict keeps place; no terminal prints and does not apply, `--yes` applies; unfetched patch refused with `--fetch` hint; `--fetch` fetches then proposes; fewer than two patches prints `nothing to reorder`; a pinned patch is tested at its pin (FR-021); no participants (all skipped or upstream-conflicting) says the order is already the best found; a `stubHarness` configured for the world records zero calls and no push happens (FR-025); and SC-005: `git for-each-ref`, `git status --porcelain` of the clone and the build directory, and `.git/rr-cache` are identical before and after

## Phase 8: Polish & Cross-Cutting

- [X] T029 [P] Document `move` and the `add --after/--before` options in `src/cli/usage.ts` (FR-027)
- [X] T030 [P] Add an ordering subsection to the "Patch list" section of `README.md` and the command table row for `move` (FR-027)
- [X] T031 [P] Add the opt-in SC-004 test `tests/integration/order-perf.test.ts` (skipped unless `DEBASER_PERF=1`): a world with 10,000 tracked files and 15 PR patches (some sharing files), `move --propose` without `--fetch` timed with `performance.now()`, asserting under 30,000 ms and printing the measured time
- [X] T032 Run `bun run typecheck` and `bun test`, fix failures, run the T031 test once with `DEBASER_PERF=1` and report the measured time, and walk `specs/003-patch-ordering/quickstart.md` scenarios 1 to 3 against `dist/debaser` after `bun run build`

## Dependencies

- Phase 1 → Phase 2 → stories.
- US1 (Phase 3), US2 (Phase 4) and US5 (Phase 5) depend only on Phase 2; US5's guard tests for `move` need T012.
- US3 (Phase 6) builds on T012's command file.
- US4 (Phase 7) needs T012 (command file) and T006 (guard); T022, T023, T024 are independent of each other.
- Polish after all stories.

## Parallel Examples

- Phase 7: T022 (`src/git/merge.ts`), T023 (`src/run/known.ts`, `status.ts`) and T024 (`src/run/fetch.ts`) touch different files and can run together, alongside T020/T021 in `src/core/order.ts`.
- Phase 8: T029, T030 and T031.

## Implementation Strategy

MVP: Phases 1 to 5 (insert, command-line move, safety and the build note), all P1. Then US3 (interactive), then US4 (proposal). Each phase ends with `bun test` green.
