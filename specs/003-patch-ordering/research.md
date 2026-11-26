# Research: Managing the order of patches

## R1: Merging in memory without touching refs or worktrees

- **Decision**: Use `git merge-tree --write-tree --name-only --no-messages <base> <patch>` (existing `mergeTreeCheck`) for every test. For a clean result that later merges build on, wrap the result tree in a synthetic commit with `git commit-tree <tree> -p <base> -p <patch> -m "debaser propose"`, run with a fixed identity (`GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL` = `debaser`) so it works in repositories without a configured user. New helper `mergeOnto(cwd, base, ref): { clean, files, commit? }` in `src/git/merge.ts` for the single tests and the verification walks, whose clean results later merges build on. Pair tests only need clean/conflict and files, so they call `mergeTreeCheck` and create no commit.
- **Rationale**: `merge-tree --write-tree` needs no worktree and never touches the index, refs or rerere (FR-013). It exists from git 2.38, debaser's minimum. Synthetic commits are unreachable objects, which the spec allows, and `gc` removes them.
- **Alternatives considered**: a temporary worktree with real merges (touches disk, slow, uses rerere); `merge-tree --stdin` batching (git 2.40+, above the minimum version, so it stays a possible later optimization); trees as merge-tree arguments (needs newer git).

## R2: What gets tested

- **Decision**:
  1. Upstream tip U: `refs/remotes/<upstream remote>/<upstream branch>`, as `status` reads it.
  2. Each live patch's commit: the pin if pinned; own branches from `refs/heads/<name>`, else `refs/remotes/origin/<name>`; PRs and fork branches from their private ref (`privateRef`). This is `status`'s `knownRefs`, moved to `src/run/known.ts` and shared.
  3. Skipped: commit is an ancestor of U (contained, or merged by merge commit), or the newest build report recorded it as `skipped-merged`. Skipped patches keep their place and take no part.
  4. Single test: `mergeOnto(U, P)`. A conflict means "conflicts with upstream alone": keeps its place, takes no part in pair rules (FR-014).
  5. Pair tests: for participants A ≠ B, `mergeTreeCheck(C_A, B)` where C_A is the synthetic commit of U+A from the single test. Pair result: `ab` clean, `ba` clean, files from the failing direction(s).
  6. Verification: walk the current order and the proposed order from U, merging each non-skipped patch onto the last clean result; a conflict is counted and the patch left out (FR-016).
- **Rationale**: matches what `build` would merge (pins, own branch tips, private refs) while reading only what the last fetch left behind (FR-020).
- **Alternatives considered**: always fetching (slow, needs network; kept as `--fetch`); rebasing own branches first (changes branches; excluded by spec).

## R3: `--fetch`

- **Decision**: `--fetch` fetches upstream into `refs/remotes/<remote>/<branch>` (`git.fetchRemote`) and each non-own patch through `fetchPatch`, whose `run` parameter is narrowed to `FetchRun = { upstream: { tip }, events }` (and `event()` in `run/common.ts` to `{ events }`, since `fetchPatch` passes its `run` on); its `skip` (`merged`/`contained`) decides skipping. The events collected during a proposal fetch are printed as `note:`/`warning:` progress lines. Own branches are never fetched.
- **Rationale**: same fetching and skip rules as `build` without duplicating them (FR-020).
- **Alternatives considered**: constructing a fake `RunState` (fragile cast); a second fetch implementation (drift).

## R4: Ordering algorithm

- **Decision**: pure function in `src/core/order.ts`:
  1. Constraints in priority order: rule 1 for every pair with exactly one clean direction (the clean direction's first patch goes first); then rule 2 for every pair conflicting in both directions with exactly one own branch (own branch goes after). Within a rule, constraints are taken in the current position order of the patch that would move.
  2. Each constraint is accepted unless the target already reaches the source through accepted constraints (it would close a cycle); a dropped constraint is reported as unavoidable.
  3. Stable topological sort (Kahn) of participants, always taking the ready patch with the lowest current position.
  4. Fixed patches (skipped, upstream-conflicting) keep their absolute indices; the sorted participants fill the other slots in order.
  5. Reasons: for each accepted constraint the current order violates, one line naming both patches by current position, the rule and the files.
  6. Unavoidable conflicts: every pair conflicting in both directions, plus dropped constraints.
- **Rationale**: deterministic, minimal movement, explainable reasons (FR-015, FR-017), testable without git.
- **Alternatives considered**: greedy step-by-step simulation (approach B in the brainstorm; hard to explain); exhaustive permutation search (n! orders).

## R5: Keeping or proposing

- **Decision**: if the verified proposed count is greater than the current count, keep the current order and say so; if the proposed order equals the current order, print "the current order is already the best order found" and ask nothing; unavoidable conflicts and upstream conflicts are shown in every case.
- **Rationale**: FR-016, FR-017, scenario 4.6.

## R6: Interactive input and interruption

- **Decision**: prompts go through `ctx.ask` (Bun's `prompt` on a terminal; tests script it through `io.ask`). `null` (end of input) ends with exit 1 and nothing saved. SIGINT/SIGTERM/SIGHUP reach the existing handlers in `main.ts`, which run interrupt cleanups (lock release) and exit 130/143/129; nothing is saved because the session writes only at its end.
- **Rationale**: no new terminal code (FR-026); interruption behavior consistent with other commands (FR-011, FR-028). The "unchanged on interrupt" guarantee is structural: the session writes `patches.json` only after its last answer, so however Bun's blocking `prompt` reacts to a signal (handler runs on return, or the process ends), nothing has been written. Answers are trimmed before they are read as numbers.
- **Alternatives considered**: raw-mode key handling (full-screen style, excluded).

## R7: The order-changed note

- **Decision**: `src/report/order-note.ts` reads `reports/*/result.json` newest first (`reportDirs`), takes the first with `command` `build` (or legacy `rebuild`) and `outcome` `success`, and keeps the `source` of patches with state `merged`, in order. Build start compares that sequence of `sourceKey`s to the current live list filtered to the same keys; a difference prints one `note:` progress line.
- **Rationale**: the data already exists; no new state (spec Assumptions); repeats until a successful build records the new order (FR-024).
- **Alternatives considered**: a flag in `patches.json` (new state, needs clearing logic).

## R8: Marking patches in printed lists

- **Decision**: `views/list.ts` `render` takes `marked?: Set<number>` (indices). A marked row shows `>` before its number (`>3`) and is bold on a terminal.
- **Rationale**: visible in piped output and in tests, consistent with the existing table (spec Assumptions, SC-002).
