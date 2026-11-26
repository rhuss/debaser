# Review Guide: Managing the order of patches

**Generated**: 2026-11-26 | **Spec**: [spec.md](spec.md)

## Why This Change

The patch list's order is the merge order, and a merge conflict always lands on the patch that merges later. Today `add` always appends, and the only way to change the order is to edit `patches.json` by hand. Nothing tells the user whether another order would merge with fewer conflicts. Two cases matter most: a patch written on top of another patch only merges cleanly after its base, and an unavoidable conflict should land on the user's own branch (which debaser already rebases) rather than on someone else's PR.

## What Changes

Users can place a new patch with `add <source> --after|--before <patch>`, move a patch with `move <patch> --after|--before <patch>`, reorder through line-based numbered prompts with plain `move`, and ask for a conflict-reducing order with `move --propose`. The proposal test-merges patches in memory, shows the current and proposed order side by side with a one-line reason per moved patch, lists the conflicts no order avoids, and asks before applying. Reordering is refused while a run is stopped or another debaser command holds the lock. After an order change, `build` prints a note that recorded conflict resolutions may no longer apply. There are no breaking changes: `patches.json` keeps its format, and plain `add` and `remove` behave as before. `move` never resolves conflicts; the next `build` does.

## How It Works

- **Pure ordering logic** in a new `src/core/order.ts`: patch reference resolution (a bare number is a position, `#N` and every other spelling is a source, as `remove` reads it), `place`/`moveTo`/`insertAt`, and the proposal's constraint sort (`propose`, `settle`). All of it is unit-tested without git.
- **In-memory merging** via `git merge-tree --write-tree` (already used by `mergeTreeCheck`). Clean results that later merges build on are wrapped in unreachable synthetic commits with `git commit-tree`, so no working tree, index, ref or rerere state changes. A new `mergeOnto` helper in `src/git/merge.ts` does this.
- **Proposal orchestration** in `src/run/propose.ts`: resolve commits from the last fetch (shared `knownCommits`, moved out of `status`), optionally `--fetch` through a narrowed `fetchPatch`, test each patch against upstream, test every pair of participants, derive the order, then verify both the current and the proposed order end to end and keep the current one if the proposal is worse.
- **Rendering**: `views/list.ts` gains marked rows (`>N`, bold on a terminal); a new `views/propose.ts` renders the side-by-side proposal.
- **Safety**: `move` joins the run lock's `locking` set; `move` and positioned `add` re-read the patch list after the lock is taken and call a new `refuseWhileRunning` guard. Prompts run under the lock.
- **Build note**: `src/report/order-note.ts` compares the live order with the merged order in the newest successful build's `result.json`; `build` prints one `note:` line when they differ.

## When It Applies

**Applies when**:
- A user adds a patch that must merge at a specific place, or wants to reorder existing live patches.
- A user wants debaser to suggest an order that avoids "built on" conflicts or moves unavoidable conflicts onto their own branches.
- A build starts after the merge order changed since the last successful build.

**Does not apply when**:
- A run is stopped or another debaser process holds the lock: reordering is refused so `continue` keeps working against its recorded plan.
- Conflicts need resolving: that stays with `build` and the harness.
- Acceptance checks or project checks: the proposal tests merge conflicts only.
- `status`: it does not run or hint at the proposal (deferred, clarified in the spec).
- JSON output for `move` and a full-screen interface: out of scope.

## Key Decisions

1. **`merge-tree --write-tree` plus synthetic commits for the proposal.** Alternatives were a temporary worktree with real merges (touches disk, slow, triggers rerere) and `merge-tree --stdin` batching (needs git 2.40, above debaser's 2.38 minimum). The chosen approach leaves only unreachable objects, which the spec explicitly allows.
2. **Rule-based stable topological sort instead of search.** Rule 1 (B builds on A) beats rule 2 (own branch goes after the patch it clashes with); ties fall back to current position, and constraints that would close a cycle are dropped and reported as unavoidable. Alternatives were greedy step-by-step simulation (hard to explain) and exhaustive permutation search (n!). The sort is deterministic, moves patches only as far as needed, and yields a reason per move.
3. **Verify both orders and keep the current one if the proposal is worse.** Pair results do not capture three-way interactions, so the full sequence is merged in memory for both orders and the counts are compared.
4. **Bare number = position, `#N` = PR.** Consistent with `add #12` and `remove #12`, at the cost of `#` meaning different things in `list` output and on the command line.
5. **Order-changed note from existing reports.** The reference order comes from the newest successful build's `result.json`; no new stored state. Alternative was a flag in `patches.json` with its own clearing logic.
6. **Reuse the existing lock and `ctx.ask`.** No new terminal or concurrency code; the lock spans the whole interactive session and the "Apply this order?" prompt.

## Areas Needing Attention

- **Performance (SC-004)**: up to 255 `merge-tree` runs plus about 45 `commit-tree` runs for 15 patches. The plan adds an opt-in timing test (`DEBASER_PERF=1`); check that the 30 s target holds on a 10,000-file repository.
- **Fixed patches keep absolute indices**: skipped patches and patches that conflict with upstream alone stay in place while participants fill the other slots. This is a reasonable reading of "keeps its current position", but it can produce reasons that look odd when many patches are fixed.
- **Lock and list freshness**: `main` loads the patch list before taking the lock. `move` and positioned `add` must re-read it after the lock is taken (`ctx.list = patchlist.load(ctx.dir)`), or FR-023 is not met.
- **Interrupts during Bun's blocking `prompt`**: the "list unchanged on interrupt" guarantee is structural (the session writes only at the end). The exact exit code on Ctrl-C at a prompt depends on Bun's signal behavior and is not covered by an in-process test.
- **Own branches at their current tip**: the proposal does not rebase own branches first, so an own branch far behind upstream may show conflicts that the next build's rebase would remove.
- **Skip detection without `--fetch`** relies on the newest build report's `skipped-merged` state plus an ancestry check, so a stale report can mark a patch skipped that the next fetch would not.

## Open Questions

No open questions identified.

## Review Checklist

- [ ] Key decisions are justified
- [ ] Breaking changes are documented with migration guidance (none expected: `patches.json` format unchanged)
- [ ] Scope matches the stated boundaries
- [ ] Success criteria are achievable
- [ ] No unstated assumptions
- [ ] `move --propose` writes no ref, working tree, index, build directory or rerere state (SC-005)
- [ ] Exit codes match FR-028 for every refusal and every "applied nothing" path

---

<!-- Code phase sections are appended below this line by the phase-manager command -->
