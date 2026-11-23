# Tasks: Dedicated build worktree and visible configuration

**Input**: Design documents from `specs/002-build-worktree/` (plan.md, spec.md, research.md, data-model.md, contracts/cli.md, quickstart.md)

**Tests**: included. Every user story has an "Independent Test" in the spec, and the repository's practice is integration tests against real git repositories (`tests/support/world.ts`).

**Conventions**: run `bun run typecheck` and `bun test <file>` after each task. Integration tests use the `world()` helpers (`world`, `configure`, `branch`, `conflicting`, `run`, `dirOf`, `latest`, `git`, `write`, `read`). A world's main checkout is `w.clone` (`<world root>/clone`), so its default build directory is `<world root>/clone-debaser`: a sibling inside the world's own temp root, isolated per world. `runWith(w, {cwd}, …)` starts debaser from another worktree. Compare paths with `realpathSync` (macOS temp dirs resolve under `/private`), as `build.test.ts` already does for `installPath(w)`.

## Phase 1: Setup

- [X] T001 Read `src/run/build.ts`, `src/run/resume.ts`, `src/run/rollback.ts`, `src/run/rebase-phase.ts`, `src/run/common.ts`, `src/git/worktree.ts`, `src/core/context.ts`, `src/core/patchlist.ts`, `src/core/runstate.ts`, `tests/support/world.ts`, and note every place that uses the started-from checkout (`ctx.repo`, `git.repoRoot`, `worktreeWith`, `isClean`). No code change.

## Phase 2: Foundational (blocks all stories)

- [X] T002 Add an optional `tree?: string` field to `PatchList` in `src/core/patchlist.ts`: parse it with the `text()` guard. Rule from data-model.md: "Absolute, or relative to the main worktree … a user-set value is kept as written. Must not be empty." An empty string is refused with an Explained error naming `patches.json`. Keep it on `save()` exactly as written. Cover parse, round-trip and empty refusal in `src/core/patchlist.test.ts`.
- [X] T003 Add `tree?: string` to `RunState` in `src/core/runstate.ts`, with a doc comment: "absolute, realpath'd build directory the run works in; absent for runs from before the build directory (FR-014)".
- [X] T004 Add `home: string` to `Context` in `src/core/context.ts` (the worktree debaser was started from), set it in `src/cli/main.ts` to the same `git.repoRoot(io.cwd)` value as `repo`. `main.ts` is the only place a `Context` is built (checked: no test builds one by hand), so typecheck is the test.
- [X] T005 [P] Add `mainWorktree(cwd)` (first `worktree` entry of `git worktree list --porcelain`, realpath'd) and `worktreeAt(cwd, path)` (`{branch: string | null}` for a registered worktree at that realpath, else null) to `src/git/worktree.ts`. Add `modifiedFiles(cwd): string[]` (tracked files with staged or unstaged changes, from `git status --porcelain --untracked-files=no`) to `src/git/git.ts`. Add unit tests beside them if the file has a test file, otherwise in `tests/integration/tree.test.ts` (T008).
- [X] T006 Create `src/core/tree.ts` with:

  **Interfaces** (used by T009, T014, T016, T019, T020):
  ```ts
  export type BuildDirectory = { path: string; recorded: boolean; exists: boolean; ours: boolean; inPlace: boolean; branch: string | null; modified: string[] };
  export function treePath(ctx: Context): { path: string; recorded: boolean };
  export function inspect(ctx: Context): BuildDirectory;          // read only
  export function prepare(ctx: Context): string;                  // refuses or returns the realpath; may create and record
  export function runTree(ctx: Context, run: RunState): string | null; // T014
  export function configInfo(ctx: Context): { dir: string; patchList: string; localRecipe: string | null; tree: BuildDirectory };
  ```

  - `treePath(ctx)`: `{path, recorded}`, where `path` is `resolve(mainWorktree, list.tree ?? "../" + basename(main) + "-debaser")`.
  - `inspect(ctx)`: the BuildDirectory fields from data-model.md: `path, recorded, exists, ours, inPlace, branch, modified`. `ours` means `git -C path rev-parse --show-toplevel` realpath equals `path`, and `--git-common-dir` resolves to `commonDirOf(ctx.home)`.
  - `prepare(ctx)`: refusals in this order, each an `Explained` with the exact wording from contracts/cli.md:
    1. foreign path;
    2. integration branch checked out in a worktree other than the build directory (`checkedOutIn`-style scan of `git worktree list --porcelain` that skips the entry at the build directory's own path, live or stale, comparing with the `/private`-tolerant match `removeWorktree` uses), with the main-worktree wording when that worktree is `mainWorktree`;
    3. build directory not on the integration branch: another branch is refused; a detached HEAD is refused when `refs/heads/<branch>` exists and accepted when it does not (debaser's own state before the first build or after a first run's rollback);
    4. modified tracked files, listing at most 10 then "and N more".

    Then create a missing directory: `removeWorktree(ctx.home, path)` to drop only its own stale registration (not a global `git worktree prune`, which would touch other worktrees' entries; FR-008), then `git worktree add <path> <branch>` when `refs/heads/<branch>` exists, else `git worktree add --detach <path> <refs/remotes/<remote>/<upstream.branch> or HEAD>`. Progress: `creating the build directory <path> from <branch|upstream>`, plus ` (it was missing)` when a stale registration for it was dropped (FR-009). When `!recorded`, set `list.tree = "../" + basename(main) + "-debaser"` and `patchlist.save`. In-place mode (`inPlace`) skips refusals 1 and 3, keeps 2 and 4 (today's worktree and clean checks on the main worktree), and creates nothing. Returns the absolute realpath.
  - `configInfo(ctx)`: `{dir, patchList, localRecipe: path | null, tree: inspect(ctx)}`.
- [X] T007 Switch `join` to `resolve` for the recipe's artifact paths, so absolute `artifact.output` and `artifact.install` are used as is (FR-010): `stepVars` and `installPath` in `src/run/common.ts`, `output` in `src/run/finish.ts` `finish()` (line ~36), and `DEBASER_ARTIFACT` in `src/run/accept.ts` `acceptLoop()` (line ~98). Add an integration test in `tests/integration/build.test.ts`: with `artifact.install` set to an absolute path under `fresh("install")`, a build installs there.

**Checkpoint**: typecheck passes and the existing suite still passes (no behavior change yet).

## Phase 3: User Story 1: Build without touching my checkout (P1) 🎯 MVP

**Goal**: `build` works in the build directory from any worktree, and the user's checkout is never touched.

**Independent Test**: dirty, feature-branch main checkout → `debaser build` succeeds in `../<name>-debaser`, and the checkout's branch, HEAD and modification are unchanged.

- [X] T008 [US1] Write failing integration tests in `tests/integration/tree.test.ts`:
  - (a) a dirty main checkout on a feature branch builds, and its branch, HEAD and `git status --porcelain` are unchanged;
  - (b) the first build creates `../<name>-debaser` on the integration branch and records `"tree": "../<name>-debaser"` in `patches.json`;
  - (c) builds started from the build directory and from a third worktree (`git worktree add`) end at the same integration tip;
  - (d) after a successful build, the build directory holds the merged patch files, the build output (`out/build`) and the installed artifact (`dist/widget-custom`), and `w.clone` holds no `dist/widget-custom`;
  - (e) `result.json` (`latest(w)`) has `tree` equal to the build directory's realpath (FR-020);
  - (f) a refusal from `preflight` (remove the `upstream` remote) leaves no build directory and no `tree` in `patches.json`. (Implemented with a patch named `debaser-prev`, another `preflight` refusal: without an `upstream` remote, debaser falls back to `origin`.)
- [X] T009 [US1] In `src/run/build.ts` `build()`:
  - remove `git.isClean(repo)` and `worktreeWith(repo, list.branch)` on the started-from checkout;
  - call `tree.prepare(ctx)` after the branch-name check and `preflight(ctx, o)` (both only read refs and remotes, so they work from any worktree, and none of their refusals may leave a created directory behind), and set `ctx.repo` to the returned path;
  - move the function's first line, `const { repo } = ctx`, below the swap (`git.requireVersion` and the busy check can use `ctx.home`), so every later `repo` is the tree;
  - record `run.tree = ctx.repo`;
  - `startTip`, `startHead`, `startBranch` and `installPath` then come from the tree with no further change.
- [X] T010 [US1] Confirm nothing captured the started-from checkout before the swap: `rg -n "const \{ repo \} = ctx|io\.cwd|process\.cwd" src/run src/report src/rebase` must show only call-time reads inside functions that run after `tree.prepare` (review found `rebase-phase.ts` `envOf`, `fetch.ts`, `finish.ts`, `live.ts`, `report.ts` already read `ctx.repo` at call time; `rebase.ts` uses `checkedOutIn`, which scans every worktree, so own branches checked out in the user's checkout are still found). The test is T008(a)/(c) passing with `rebase: "all"` via `configureOwn` and an own branch checked out in `w.clone`, which stays checked out and unchanged there.
- [X] T011 [US1] Print `build directory <path>; patch list <dir>/patches.json` with `ctx.progress` right after `tree.prepare` in `src/run/build.ts` (FR-019), and add `tree` to `result.json` in `src/report/report.ts` (FR-020).
- [X] T012 [US1] **Done by the pragmatic route**: `configure()` in `tests/support/world.ts` records `"tree": "."` (in-place, US5), so the existing suites keep exercising the run machinery against `w.clone` unchanged (the `ctx.repo` swap is the same in both modes; see the comment on `configure`). `configureTree()` leaves `tree` unset, and `treeOf(w)`/`treeInstallPath(w)` point at `<world root>/clone-debaser`; `tree.test.ts` and `config.test.ts` cover the sibling build directory for build, conflict stop + continue, step failure with harness fix, acceptance, rollback, the rebase phase, and SC-004's install-trigger check. Original plan: Update existing integration tests whose expectations assumed an in-place build. Add `treeOf(w) = join(w.root, "clone-debaser")` to `tests/support/world.ts` and change `installPath(w)` to `join(treeOf(w), "dist", "widget-custom")`. Then, in `build`, `stops`, `harness`, `status`, `live`, `recipes`, `acceptance`, `handoffs` and the build-phase cases of `rebase` (`.test.ts` in `tests/integration/`), point at `treeOf(w)`: conflict resolution and `git add` before `continue`, reading build output or merged files, `git branch --show-current`/`rev-parse HEAD` of the integration branch's checkout, and dirty-tree setups meant to block a build. Expectations about `debaser rebase` (no build) stay on `w.clone`. The existing "the install step runs when nothing is installed or a trigger file changed, and is skipped otherwise" test, now running in the build directory, is SC-004's check. Run the full suite until green.

**Checkpoint**: US1 tests pass, and the full suite is green.

## Phase 4: User Story 2: Stops, continue and rollback in the build directory (P1)

**Goal**: stops point at the build directory, and `continue`/`rollback` work there from anywhere without touching the user's checkout.

**Independent Test**: a conflict stop names the build directory; resolve it there, `continue` from the main checkout, and the run finishes; a stop followed by `rollback` restores the previous build, with the main checkout unchanged.

- [X] T013 [US2] Write failing tests in `tests/integration/tree.test.ts`:
  - (a) a conflict stop's output has a `build directory: <path>` line, and `fix-conflict.md` and its "run it: cd" hint name the build directory; a step-failure stop (`BROKEN` in a `.txt`) has the same line, and `fix-<step>.md` names it; a handoff written by a stop has `- Build directory: <path>`;
  - (b) resolve in the build directory, then `continue` from `w.clone` exits 0;
  - (c) a stopped run followed by `rollback` from `w.clone` puts the integration branch back at its previous tip, deletes it after a first run, and leaves `w.clone` unchanged;
  - (d) a step failure with a stub harness (`stubHarness`) commits its fix in the build directory;
  - (e) with a stopped run and the build directory deleted (`rmSync`, no `git worktree remove`), `continue` refuses with "the build directory <path> is gone; undo the run with `debaser rollback`", and `rollback` then succeeds, moves the integration branch back (or deletes it after a first run), and clears the run; the next `build` recreates the directory.
- [X] T014 [US2] Add `runTree(ctx, run)` to `src/core/tree.ts`:
  - when `run.tree` is set, return it if it exists, else null;
  - legacy runs (no `run.tree`, FR-014): return `checkedOutIn(ctx.home, list.branch)`, or refuse with "no worktree has <branch> checked out; check it out again where the run was started" (the spec's FR-014 wording; pointing at `rollback` here would loop, since `rollback` needs the same worktree). It never applies the FR-016 refusal.
- [X] T015 [US2] In `src/run/resume.ts` `resume()`: keep the `run.phase === "rollback"` hand-off to `rollback(ctx)` and the rebase branch first (both resolve their own checkout). Then, for build runs, set `ctx.repo` from `runTree`, refusing with the T013(e) message when it is null, and only then destructure `const { repo } = ctx` (today the function's first line). In the "still has unmerged files" stop, add `  build directory: <ctx.repo>`.
- [X] T016 [US2] In `src/run/rollback.ts` `rollback()`:
  - move `const { repo } = ctx` below the swap;
  - with a build run, set `ctx.repo` from `runTree`;
  - drop the "uncommitted changes" check on a non-integration branch (the build directory's changes belong to the run); **deviation**: the check is kept, applied to the build directory. Changes on the integration branch are the run's and are discarded without a check (FR-007), but edits on another branch the build directory was switched to are not the run's, and the forced checkout would destroy them (`stops.test.ts` "rollback of a stopped run keeps uncommitted edits on another branch" pins this);
  - when the tree is missing: `removeWorktree(ctx.home, run.tree)` first (git refuses `branch -f`/`branch -D` on a branch held by a registered worktree even when its directory is gone; verified with git 2.56), then `git branch -f <branch> <startTip>` (or `git branch -D <branch>` when there was no start tip) from `ctx.home`, skip the artifact and dependency restore, and clear the run;
  - without a run (`-prev` restore), call `tree.prepare(ctx)` and set `ctx.repo` to its result: the same refusals as `build` (FR-007, the clean check included), and a missing directory is recreated from the branch. The old `git.isClean(repo)` line goes.
- [X] T017 [US2] Name the build directory in every stop (FR-011, SC-006). Today only the agent hints' `run it: cd <ctx.repo>` do; the stop lines, the prompt files and the handoffs name no directory (`{{checkout}}` in `handoff.md` is the patch's own branch). Change:
  - `src/run/stop.ts` `stop()`: add `  build directory: <ctx.repo>` right after the reason lines, so conflict, step, acceptance and harness stops all carry it;
  - `src/run/stop.ts` `agentHint()` and `conflictHint()`: the epilogue appended to each prompt file starts with "You are working in the build directory <ctx.repo>.";
  - `src/prompts/handoff.md`: add `- Build directory: {{tree}}` under `- Upstream:`, and pass `tree: ctx.repo` from `base()` in `src/report/handoff.ts`.

  Pinned by T013(a).

**Checkpoint**: US1 and US2 tests pass.

## Phase 5: User Story 3: See which configuration debaser uses (P2)

**Goal**: `list`, `status`, `recipe`, the start of a build and `--json` show where the configuration lives.

**Independent Test**: with a local `recipe.toml`, the outputs show the data directory, `patches.json`, the local recipe, the build directory and every layer's source.

- [X] T018 [P] [US3] Write failing tests in `tests/integration/config.test.ts`:
  - (a) the first two lines of `list` and of `status` are the `config` and `build` header lines from contracts/cli.md, including `(local recipe: none)` and `(not created yet)` before the first build;
  - (b) `list --json` and `status --json` have `config.{dir, patchList, localRecipe, tree.path, tree.exists}`;
  - (c) `recipe` names `(built-in)` layers and `local <dir>/recipe.toml`, and `recipe --json` has `layerSources`;
  - (d) a build's output contains `build directory <path>; patch list <path>` once, and with `runWith(w, {sink})` the live view gets it as one `{t: "log"}` event;
  - (e) a committed `.debaser/recipe.toml` on upstream, trusted (as `recipes.test.ts` sets it up), shows as `repo .debaser/recipe.toml at upstream <sha7>` and in `layerSources` as `{kind: "repo", path, commit}`;
  - (f) `status` after a build with a modified tracked file in the build directory shows `(1 modified file)` and lists it, and `status --json` has it in `config.tree.modified`; after deleting the directory, `status` shows `(missing)`; after `git -C <tree> switch -c other`, it shows `(on other, not debaser)` (FR-022).
- [X] T019 [US3] Add a `configHeader(info, {color})` renderer in `src/views/config.ts`, producing two lines with the `build` line suffixes from contracts/cli.md: `(not created yet)`, `(missing)`, `(in place)`, `(on <branch>, not <integration branch>)`, `(N modified files)`. Prepend it in `src/cli/commands/list.ts` and `src/cli/commands/status.ts`, and add `config: configInfo(ctx)` to both JSON payloads.
- [X] T020 [US3] In `src/cli/commands/status.ts`, list the build directory's modified files under the header when there are any (FR-022), and keep `status` read-only: it must never call `tree.prepare`.
- [X] T021 [US3] In `src/cli/commands/recipe.ts` and its renderer, derive each layer's source from its id: `generic:*` and `project:*` → `(built-in)`; `repo:<path>@<sha7>` → `repo <path> at upstream <sha7>`; `local` → `local <dir>/recipe.toml`. Show them on the layers line, and add `layerSources` to the JSON (data-model.md).

**Checkpoint**: US3 tests pass.

## Phase 6: User Story 4: Existing projects move over without a rebuild (P2)

**Goal**: an existing integration branch becomes the build directory; the refusals name what blocks.

**Independent Test**: an old-style in-place build, then `git switch main`, then `debaser build` creates the build directory from the existing branch, and `rollback` still reaches `debaser-prev`.

- [X] T022 [US4] Write tests in `tests/integration/tree.test.ts`:
  - (a) with the integration branch existing and no `tree`, the first build creates the directory from that branch (its HEAD before the run equals the old tip), and afterwards `rollback` (no run) restores `debaser-prev`;
  - (b) with `w.clone` on the integration branch, `build` exits 1 with the main-checkout message from contracts/cli.md, and nothing changes (refs, `patches.json`, no directory);
  - (c) with the integration branch checked out in a separate `git worktree add` directory, `build` exits 1 naming that path;
  - (d) a legacy stopped run: make a run stop, delete `tree` from `run.json`, check the integration branch out in `w.clone` (simulating an old in-place run), resolve the conflict there, and `continue` from `w.clone` succeeds;
  - (e) the same legacy setup, then `rollback` from `w.clone` restores the integration branch there and clears the run, with no FR-016 refusal;
  - (f) a legacy run with no worktree holding the integration branch: `continue` refuses with the T014 wording.
- [X] T023 [US4] Make T022 pass. The refusals come from `tree.prepare` (T006), and the legacy path from `runTree` (T014). Fix the wording and order there if a test shows a gap.

## Phase 7: User Story 5: Build in place for CI (P3)

**Goal**: `"tree": "."` keeps today's in-place behavior.

**Independent Test**: with `tree` set to `.`, a clean checkout builds in place and ends on the integration branch; a dirty one is refused.

- [X] T024 [US5] Write tests in `tests/integration/tree.test.ts`: (a) `tree: "."` builds in `w.clone`, which ends on the integration branch; (b) `tree: "."` with a modified tracked file is refused, listing the file.
- [X] T025 [US5] Make T024 pass: in-place handling in `tree.prepare` (T006), plus the `checkout -B` in `src/run/build.ts`, which already works in place once `ctx.repo` is the main worktree.

## Phase 8: Edge cases

- [X] T026 Write tests in `tests/integration/tree.test.ts` for the spec's edge cases:
  - a modified tracked file in the build directory refuses the build, listing it (and untracked files do not);
  - the build directory switched to another branch refuses; so does a detached HEAD there while the integration branch exists;
  - a deleted build directory (`rmSync`, registration left behind) is recreated at the same path and the output says so;
  - a recorded path that is a plain directory refuses as foreign, and so does a plain directory at the default path before the first build (nothing recorded);
  - a user-set `"tree": "../elsewhere"` builds in `<world root>/elsewhere` and stays `"../elsewhere"` in `patches.json` (FR-004);
  - debaser started inside a linked worktree uses the same default path;
  - with `DEBASER_DIR` outside the repository, the default build directory is still `<world root>/clone-debaser`, and `tree` is recorded in that directory's `patches.json`;
  - `rollback` with no run and a build directory on another branch refuses (FR-007 applies to rollback too).

  Fix `src/core/tree.ts` where they fail.

## Phase 9: Polish & Cross-Cutting

- [X] T027 [P] Update `README.md`: describe the build directory (where it lives, the `tree` field, in-place `"."`, removing it with `git worktree remove`), the configuration header, and the installed artifact now living in the build directory. Update the usage text in `src/cli/usage.ts` (one line on the build directory). Update `docs/harness.md` and `docs/pilots.md` where they say the build happens in the checkout.
- [X] T028 [P] Update `docs/behavior-contract.md` right-column titles if any test titles were renamed in T012, and run `bun test tests/contract.test.ts`. (No title was renamed; the contract test passes.)
- [X] T029 Run `bun run typecheck`, the full `bun test` suite and `bun run build`. Then walk through quickstart.md scenarios 1, 4 and 7 against the compiled binary in a scratch repository under the session scratchpad.

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T002–T007) → US1 (T008–T012) → US2 (T013–T017), because US2 relies on the swap from US1.
- US3 (T018–T021) depends only on Phase 2 (`configInfo`, `inspect`) and can run in parallel with US1/US2.
- US4 (T022–T023) and US5 (T024–T025) depend on US1 and US2.
- Edge cases (T026) after US4. Polish (T027–T029) last.

## Parallel Opportunities

- T005 runs in parallel with T002–T004 (different files).
- T018–T021 (US3) run in parallel with T008–T017 once Phase 2 is done.
- T027 and T028 run in parallel.

## Implementation Strategy

MVP = Phase 2 + US1. It removes both refusals the user hit and leaves the checkout alone. US2 must follow before release, because stops would otherwise point at the wrong place. US3 (configuration display) is independent and small. US4 and US5 harden the migration and CI.
