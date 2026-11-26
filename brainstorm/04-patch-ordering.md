# Brainstorm: Managing the order of patches

**Date:** 2026-11-26
**Status:** spec-created (specs/003-patch-ordering, merged in 554e28d)

## Problem Framing

The order of the patch list is the merge order: `build` merges `patches` from `patches.json` onto upstream one after the other. Today the only way to influence that order is the order of `add` calls (`add` always appends) or editing `patches.json` by hand. There is no way to insert a patch at a chosen place, to move one, or to find out whether another order would merge with fewer conflicts.

Success: a user can put a new patch where it belongs, reorder the list in a few keystrokes while seeing which patch is which, and ask debaser for an order that avoids conflicts, with a one-line reason per moved patch.

Non-goals and anti-goals:
- No full-screen TUI. The interactive mode is plain numbered prompts.
- No conflict resolution in `move`. Resolving conflicts (harness, rerere, separate commits, `--push`) stays in `build`; a second resolution path would duplicate it and drift.
- A proposal must never claim an order is safe beyond what it tested: the in-memory merge test sees merge conflicts only, not checks that fail after a clean merge.
- Reordering must never desynchronize a stopped run from its patch list.

## Approaches Considered

How `move --propose` computes an order (the command surface was settled before this choice).

### A: Pairwise test, then verify the whole order (chosen)
- Test-merge every pair of patches in both orders in memory (`git merge-tree --write-tree`, already used in `src/git/merge.ts:18`): which pairs conflict in any order, which only merge in one order (stacked patches), which files collide.
- Derive the proposal: base patches before patches that build on them, own branches after the patches they clash with, everything else keeps its current place.
- Merge the proposed order once start to finish to confirm it and report the real conflict count.
- Pros: every move has a one-line reason ("#5 moved after #2: both change `src/x.ts`; #5 is your branch"); about n(n-1) quick merges, a few seconds for 15 patches.
- Cons: conflicts that need three or more patches together only show up in the final verification, not in the reasons.

### B: Step-by-step simulation
- Starting from upstream, pick at each step the next patch that merges cleanly onto the result so far.
- Pros: more accurate when several patches pile onto the same code.
- Cons: reasons are hard to explain ("chosen at step 4"), which works against the goal of a clear proposal.

### C: Rules only, no merging
- Own branches last; a PR after the PR it targets on GitHub.
- Pros: instant, no fetch.
- Cons: blind to real conflicts, which is why the proposal is wanted.

### Dropped
- Full-screen TUI for reordering: the user preferred slim numbered prompts.
- `$EDITOR`-based reordering like `git rebase -i`: loses the numbered prompts.
- Resolving conflicts from within `move` via the harness: `build` already does this; `move` only changes order.
- Rebasing an own branch onto the patch it conflicts with: makes the branch depend on that patch, so it can no longer go upstream on its own.

## Decision

Approach A for the proposal, inside a `move` command that only edits the order. `build` remains the single place where conflicts are resolved.

## Key Requirements

User decisions:
- `add <source> --after <patch>` inserts a new patch at a chosen place instead of appending.
- `move` reorders patches; called without arguments it is interactive with numbered prompts: which patch (by `#`), to which position (by number).
- After each interactive move, ask whether another patch should be moved; the loop ends on Enter or "n".
- Reordering (`move`, `add --after/--before`) is refused while a run is stopped or in progress (the run state records where it stopped; `continue` must resume against the same order).
- `move --propose` proposes an order that reduces conflicts and asks before applying it.
- When two patches conflict in every order, the proposal puts the user's own branch later, so the conflict lands on the patch the user controls.
- `move` does not resolve conflicts; they are resolved by the next `build` (harness, rerere, `--push`).

Proposals by Claude, with reasons:
- Patch references accept the `#` number shown by `list` or the source spelling `remove` accepts (numbers are quick to type, sources stay stable in scripts).
- `--before <patch>` alongside `--after`, for `add` and `move`, so a patch can be put first without a special `--first` flag.
- `move <patch> --after/--before <patch>` as the non-interactive form for scripts.
- Interactive `move` prints the numbered list (same table as `list`) before asking, and the new order with the moved line highlighted after each move; it saves once at the end.
- Off a terminal, plain `move` fails with a usage hint, as `remove` does without `--reason`.
- Every reorder prints the resulting list.
- The next build after an order change notes once that recorded conflict resolutions may no longer apply.
- `--propose` shows current and proposed order side by side, a one-line reason per moved patch, the conflicts that no order avoids (marked as going to the harness on the next build), and that only merge conflicts were tested. On "apply", it saves the order and prints `debaser build` as the next step instead of starting a build.

## Open Questions
- Does `--propose` fetch first, or work on the last fetched refs with an optional `--fetch` (as `status` does)?
- How is "stacked" detected: one patch containing the other's commits, the pairwise one-order-only result, or the PR's base branch on GitHub?
- Should `status` hint when a different order would avoid conflicts, or does that cost too much on every `status`?
- What does the proposal do with pinned patches and patches with acceptance checks: treat them like any other, or keep them in place?
- Is "a run in progress" detected from the lock as well as the stopped run state?
