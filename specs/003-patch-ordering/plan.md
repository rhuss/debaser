# Implementation Plan: Managing the order of patches

**Branch**: `003-patch-ordering` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-patch-ordering/spec.md`

## Summary

Add order management to the patch list: `add --after/--before <patch>` inserts at a chosen place, `move <patch> --after/--before <patch>` reorders from the command line, plain `move` reorders through line prompts, and `move --propose` suggests a conflict-reducing order. The proposal test-merges patches with `git merge-tree --write-tree` (already used by `mergeTreeCheck`) on synthetic commits made with `git commit-tree`, so no working tree, index or ref changes. Ordering logic (reference resolution, moves, the constraint sort) lives in a pure module with unit tests; git work and the command live in thin layers on top. Reordering takes the existing run lock and refuses while run state exists. `build` prints a note when the merge order differs from the last successful build's recorded order.

## Technical Context

**Language/Version**: TypeScript 5.9 on Bun 1.4 (compiled to a single binary with `bun build --compile`)

**Primary Dependencies**: none at run time (only `git` ≥ 2.38 and, for `--fetch` of PR sources, `gh`); no new dependency (FR-026)

**Storage**: `patches.json` in debaser's data directory; the order is the order of the `patches` array, so the file format does not change. Reads `run.json` (run state), the run lock, and `reports/*/result.json`.

**Testing**: `bun test`; unit tests next to sources (`src/**/*.test.ts`), integration tests in `tests/integration/` on real git repositories built by `tests/support/world.ts`, calling `main(argv, io)` with a scripted `io.ask`

**Target Platform**: macOS and Linux terminals and CI

**Project Type**: CLI

**Performance Goals**: `move --propose` for 15 patches on a repository of up to 10,000 tracked files in under 30 s (SC-004): n single tests + n(n-1) pair tests + up to 2n verification merges, i.e. at most 255 `merge-tree` runs for n = 15, plus a `commit-tree` only for the clean single and verification results that later merges build on (at most 3n = 45); pair tests use `mergeTreeCheck` and create no commit. Measured by the opt-in performance test (tasks.md, Polish)

**Constraints**: no working tree, index, ref or rerere change during a proposal (FR-013); line-based prompts only (FR-026); lock held for the whole command (FR-023)

**Scale/Scope**: patch lists of a few to a few dozen patches

## Global Constraints

Every task inherits these values, copied from spec.md:

- Runtime: no new runtime dependencies; no full-screen terminal interface; interactive input is line-based (FR-026). Minimum git stays 2.38 (`merge-tree --write-tree`, `git.requireVersion`).
- Positions count from 1, as in `list`. A bare number (`/^\d+$/`) is a position in the live list; `#N`, `owner/repo#N`, URLs and branch names are sources, read exactly as `remove` reads them (FR-001, FR-002).
- Exit codes (FR-028): `move` exits 0 when it applies an order and when it applies nothing on purpose (declined, already best, unchanged, printed without a terminal, nothing to reorder); exit 1 on every refusal (stopped run, held lock, unfetched patches, invalid references or options). `add` exits 1 on refusals of `--after`/`--before`. Interactive end of input exits 1; signals exit 129/130/143.
- "Move another patch?": `y` or `yes` in any case continues; anything else, including Enter, ends (FR-010).
- `move --propose` writes nothing but unreachable objects: no working tree, index, ref, build directory or rerere change (FR-013, SC-005).
- The lock is held from before the patch list is read until after it is written, including every prompt (FR-023).
- Performance: 15 patches, up to 10,000 tracked files, `move --propose` without `--fetch` under 30 s (SC-004).
- `status` does not run or hint at the proposal (FR-029); `move` never resolves conflicts, calls the harness, pushes or builds (FR-025).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template, so it defines no project gates. The plan follows the conventions visible in the codebase and earlier specs instead:

- No runtime dependencies: satisfied (only git and the existing `gh` use for `--fetch`).
- Commands that change debaser's files take the run lock (`locking` set in `src/cli/main.ts`): `move` is added to it.
- Pure logic tested by unit tests, behavior by integration tests on real repositories: followed.
- Every user-visible behavior documented in `usage` and the README: FR-027.

Post-design re-check: no violations; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-patch-ordering/
├── plan.md              # This file
├── research.md          # Phase 0: decisions on merge simulation, sort, refs, prompts
├── data-model.md        # Phase 1: references, pair results, proposal
├── quickstart.md        # Phase 1: runnable validation scenarios
├── contracts/
│   └── cli.md           # Phase 1: the add/move command contract
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── order.ts            # NEW, pure: parse/resolve patch references, insert, move,
│   │                       #   reorder diff, constraint sort (proposal ordering), reasons
│   ├── order.test.ts       # NEW unit tests
│   ├── guard.ts            # NEW: refuseWhileRunning(ctx) (run state present → Explained)
│   └── guard.test.ts       # NEW unit test
├── git/
│   ├── merge.ts            # + mergeOnto(cwd, base, ref): merge-tree + commit-tree for a clean result
│   └── git.test.ts         # + mergeOnto test (refs unchanged)
├── run/
│   ├── build.ts            # prints the order-changed note at the start of a new build
│   ├── common.ts           # event() takes the narrow {events} it uses
│   ├── fetch.ts            # fetchPatch takes a narrow {upstream, events} instead of RunState
│   ├── known.ts            # NEW: knownCommits(ctx) (moved from status.ts's knownRefs)
│   └── propose.ts          # NEW: gather commits, optional fetch, pair tests, verification
├── report/
│   ├── order-note.ts       # NEW: lastBuildOrder(ctx), orderChanged(ctx) for the build note
│   └── order-note.test.ts  # NEW unit tests
├── views/
│   ├── list.ts             # + marked patches (textual marker + color)
│   ├── list.test.ts        # NEW (or extended): marked rows
│   └── propose.ts          # NEW: side-by-side current/proposed, reasons, unavoidable conflicts
├── cli/
│   ├── commands/add.ts     # + --after/--before, guard, printed list
│   ├── commands/move.ts    # NEW: command-line, interactive and --propose forms
│   ├── commands/index.ts   # + Options after/before/propose/yes; move verb
│   ├── commands/status.ts  # uses run/known.ts
│   ├── main.ts             # move joins the locking set
│   └── usage.ts            # documents move and the add options

tests/integration/
├── order.test.ts           # NEW: add positions, move forms, interactive, propose, guards, note
└── order-perf.test.ts      # NEW, opt-in (DEBASER_PERF=1): SC-004 timing

README.md                   # Patch list section: ordering
```

**Structure Decision**: Single project, following the existing layering: pure logic in `src/core`, git plumbing in `src/git`, run-level orchestration in `src/run`, rendering in `src/views`, commands in `src/cli/commands`.

## Design Notes

- **References (FR-001, FR-002)**: `/^\d+$/` is a position (1-based, live list); anything else goes through `parse(arg, upstream.repo)` and `sameSource`, exactly like `remove`. Errors name the valid range or say "not in the list".
- **Placement**: `--after X` places the patch at index(X)+1 and `--before X` at index(X), computed after removing the moved patch from the list, so moving downwards and upwards both land next to X.
- **Interactive (FR-009 to FR-012)**: uses `ctx.ask` (Bun's `prompt`, null at end of input). The session works on a copy of `patches`; it saves once at the end only if the order changed. `ask` returning null exits 1 without saving; signals go through the existing `git.interrupt` path (lock released, nothing saved because nothing was written yet). Without `io.ask`, plain `move` is a usage error.
- **Proposal (FR-013 to FR-021)**: see research.md R1 to R5. Pure ordering in `core/order.ts` takes pair results and returns the order, accepted and dropped constraints; `run/propose.ts` does the git work. Commits for skipped patches (contained in upstream) and patches that conflict with upstream alone keep their absolute positions; the sorted participants fill the remaining slots.
- **Apply (FR-018, FR-019)**: on a terminal, ask "Apply this order? [y/N]"; off a terminal print and hint `--yes`; `--yes` applies. Applying saves, prints the marked list and `next: debaser build`.
- **Guard (FR-022, FR-023)**: `move` joins the `locking` set, so the lock is held until the process ends. `main` loads `ctx.list` before `acquire`, so `move` and `add` with a position option set `ctx.list = patchlist.load(ctx.dir)` at the start of `run` (the lock is held by then) and use only that fresh list; helpers such as `listOf(ctx)` and `knownCommits(ctx)` then see it too. `refuseWhileRunning` refuses when `loadRun(dir)` returns state, naming `continue` and `rollback`. `add` calls the guard only with a position option (FR-022, scenario 5.5).
- **Order note (FR-024)**: `lastBuildOrder` reads result.json files newest first and takes the first with `command` build and `outcome` success; its `merged` patches give the reference order by `sourceKey`. The current live list filtered to those keys is compared in order; a difference prints `note: the merge order changed since the last successful build; recorded conflict resolutions may not apply` once at build start.

## Interfaces

Names and types shared between tasks. A task that consumes one of these uses exactly this name and signature. `Patch` is `core/patchlist`'s type; `Context` is `core/context`'s.

```ts
// src/core/order.ts (pure)
export type At = { after: number } | { before: number };            // 0-based index of the reference patch
export function resolveRef(patches: Patch[], arg: string, upstreamRepo: string): number; // 0-based; throws Explained
export function place(patches: Patch[], from: number, at: At): Patch[];   // new array; throws Usage when at's index === from
export function moveTo(patches: Patch[], from: number, to: number): Patch[]; // interactive: `to` is the 0-based final index
export function insertAt(patches: Patch[], patch: Patch, at: At): Patch[];
export function sameOrder(a: Patch[], b: Patch[]): boolean;          // compares sourceKey sequences
export type PairResult = { a: number; b: number; ab: boolean; ba: boolean; files: string[] }; // a < b
export type Participant = { index: number; own: boolean; commit: string };
export type Fixed = { index: number; why: "skipped" | "upstream"; files?: string[] };
export type Constraint = { first: number; then: number; rule: 1 | 2; files: string[] };
export type Proposal = {
  current: number[]; proposed: number[]; reasons: string[];
  unavoidable: { a: number; b: number; files: string[] }[];
  upstream: { index: number; files: string[] }[]; skipped: number[];
  counts: { current: number; proposed: number }; kept: boolean;
};
export function propose(names: string[], participants: Participant[], fixed: Fixed[], pairs: PairResult[]):
  Omit<Proposal, "counts" | "kept">;                                  // names[i] = display of current index i
export function settle(p: Omit<Proposal, "counts" | "kept">, counts: Proposal["counts"]): Proposal;
                                                                      // kept = counts.proposed > counts.current; then proposed = current

// src/core/guard.ts
export function refuseWhileRunning(ctx: Context): void;               // throws Explained when run state exists

// src/views/list.ts: render(config, o) gains o.marked?: Set<number> (0-based indices)

// src/report/order-note.ts
export function lastBuildOrder(ctx: Context): string[] | null;        // sourceKeys of merged patches, in order
export function orderChanged(ctx: Context): boolean;

// src/git/merge.ts
export function mergeOnto(cwd: string, base: string, ref: string): { clean: boolean; files: string[]; commit?: string };

// src/run/known.ts
export function knownCommits(ctx: Context): { display: string; ref: string | null }[];

// src/run/fetch.ts, src/run/common.ts
export type FetchRun = { upstream: { tip: string }; events: Event[] };
export function fetchPatch(ctx: Context, patch: Patch, run: FetchRun): Planned;
export function event(run: { events: Event[] }, kind: string, fields?: Omit<Event, "kind">): void;

// src/run/propose.ts
export function computeProposal(ctx: Context, o: { fetch: boolean }): { proposal: Proposal; names: string[] };

// src/views/propose.ts
export function render(p: Proposal, names: string[], o: { color: boolean }): string[];
```

## Review Focus

Inputs the spec implies but does not list, each pinned by a test in the owning task:

- Reference spellings: `0`, `-1`, a value starting with `#` given to `--after`, a reference to a retired-only source, and a position on an empty list (`add <src> --after 1` on a new list) are refused with exit 1 and nothing written (T003, T009).
- `--after`/`--before` with no value: the existing `option()` throws `Usage` (T009, T011).
- `move` before any `add` (no patch list): the existing `listOf` refusal, exit 1 (T011).
- Interactive answers with surrounding spaces (` 2 `) are trimmed; `0`, out-of-range and non-numeric answers re-ask with the range (T018).
- End of input in the middle of a session (after one move) leaves `patches.json` byte-identical (T018).
- `--propose` where every patch is skipped or conflicts with upstream alone (no participants): no pair tests, "already the best order found", exit 0 (T028).
- `--propose` with a pinned patch and with an own branch that exists only as `origin/<name>` (T028).
- A held lock is simulated with a live pid other than the test process (`process.ppid`): `acquire` takes over a lock whose pid is its own (T013).

## Complexity Tracking

No constitution violations.
