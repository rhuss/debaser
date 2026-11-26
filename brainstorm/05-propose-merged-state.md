# Brainstorm: Merged-upstream detection in `move --propose` without `--fetch`

**Date:** 2026-11-26
**Status:** active

## Problem Framing

`move --propose` leaves out patches that are already in upstream. With `--fetch` it decides this the way `build` does (`fetchPatch`): a PR is merged when GitHub reports it merged into the upstream repository and its merge commit is in the fetched upstream tip, and any patch whose commit is an ancestor of upstream is contained. Without `--fetch` it only checks ancestry plus the `skipped-merged` marks of the newest build report (`mergedUpstream` in `src/run/propose.ts`). A `--fetch` run records nothing.

So two proposals on the same fetched state can disagree: after a PR is squash-merged or rebase-merged upstream (not caught by ancestry), `move --propose --fetch` skips it while a following plain `move --propose` test-merges it, as long as no build has run since. Merge-commit merges are not affected (ancestry catches them).

Success: on the same fetched state, `move --propose` and `move --propose --fetch` skip the same patches whenever `gh` answers, and the plain command says so plainly when it could not ask.

Non-goals: changing `build`, `status`, or `move --propose --fetch`; persisting fetch results in a new file; working fully offline without saying so.

Anti-goals: a plain `move --propose` that fails because `gh` is missing, not logged in, or offline.

Scope: only `move --propose` without `--fetch`.

## Approaches Considered

### A: Ask `gh` at proposal time, fall back to the build report (chosen)
- Without `--fetch`, look up each upstream PR's state with `gh` (the existing `prInfo`, as `status` does) and apply `build`'s rule against the last fetched upstream tip: merged on upstream and the merge commit is an ancestor of `refs/remotes/<remote>/<branch>`.
- A PR whose lookup fails falls back to the newest build report's `skipped-merged` mark plus ancestry, and the proposal prints a one-line note.
- Pros: no new state; one rule shared with `build`; both paths agree whenever `gh` works; reuses existing code.
- Cons: one `gh` call per upstream PR (about half a second each, a few seconds for 15 PRs, inside the SC-004 budget of spec 003); the fallback can be stale.

### B: Record fetch results (the original inbox idea)
- `build` and `move --propose --fetch` write each patch's skip state to a file in debaser's data directory; plain `move --propose` reads it.
- Pros: offline; `status` could use it too.
- Cons: new state that other fetches (`status --fetch`, a manual `git fetch`) do not update; solves offline use, which the user does not need.

### C: Both (gh, then the record, then the report)
- Pros: widest coverage.
- Cons: three sources of truth for one yes/no answer; most complexity for a rare case.

### Dropped
- Always requiring `--fetch`: the plain command must keep working.
- Removing the report fallback: a missing `gh` would silently lose information available today.

## Decision

Approach A. It is the smallest change that makes both paths agree, reuses the `gh` lookup `status` already uses, and adds no persistent state.

## Key Requirements

User decisions:
- Without `--fetch`, `move --propose` may look up PR states with `gh`.
- When the lookup is not possible, it falls back instead of failing.
- The fallback is announced with a one-line note, both when `gh` is unavailable as a whole and when a single PR's lookup fails.
- Only `move --propose` without `--fetch` changes.

Proposals by Claude, with reasons:
- The merged rule is exactly `build`'s, applied to the last fetched upstream tip rather than a new fetch, so both proposal paths agree on the same fetched state (FR-020 of spec 003, "the last fetch").
- A PR merged upstream after the last fetch stays a participant until the next fetch, consistent with "uses the last fetch".
- Fallback per PR: the newest build report's `skipped-merged` mark plus ancestry, as today.
- Note wording, for example: `note: PR states unavailable (gh: not logged in); a PR squash-merged since the last build may be test-merged`; for single failures it names the PRs.
- Pinned PRs keep their rule: merged only when upstream contains the pinned commit.
- Own branches and other forks' branches are unaffected (ancestry only, as today).

## Open Questions
- Is one `gh` call per PR fast enough in practice, or should lookups be batched (one GraphQL query) when the list is long?
- Should the note distinguish "gh missing", "not logged in" and "network error", or is one generic reason enough?
- Should a lookup that reports "merged" but whose merge commit is missing from the last fetch hint at `--fetch`?
