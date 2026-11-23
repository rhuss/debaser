# Implementation Plan: Dedicated build worktree and visible configuration

**Branch**: `002-build-worktree` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-build-worktree/spec.md`

## Summary

`build`, `continue` and `rollback` stop working in the checkout debaser was started from. They work in one build directory per project: a linked worktree that holds the integration branch, whose path is recorded in the patch list (`tree`, default `../<main-worktree-name>-debaser`). The core move is small, because every run helper already works against `ctx.repo`. A new resolver (`src/core/tree.ts`) validates or creates the build directory and repoints `ctx.repo` to it before the run starts, so merges, steps, installs, harness calls, prompts and handoffs follow automatically. The checks on the user's checkout (clean tree, "checked out in another worktree") move to the build directory. A run records its `tree`, so `continue` and `rollback` find it from any worktree, and runs from before the change (no `tree`) fall back to the worktree that holds the integration branch. On top of that, `list`, `status`, `recipe` and the start of a build show where the configuration lives (data directory, `patches.json`, local `recipe.toml`, recipe layer sources, build directory), in text and JSON.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.4 (compiled to a single binary with `bun build --compile`)

**Primary Dependencies**: none new; git ≥ the version `git.requireVersion` checks (worktree support)

**Storage**: files in debaser's data directory (`patches.json`, `run.json`, `result.json`), git refs in the shared repository

**Testing**: `bun test`: unit tests beside modules in `src/`, integration tests in `tests/integration/` built on `tests/support/world.ts` (real git repositories in temp dirs), the contract test `tests/contract.test.ts`

**Target Platform**: macOS and Linux CLI (CI runs both)

**Project Type**: CLI tool

**Performance Goals**: no extra cost per run beyond one `git worktree list` and, on first use, one `git worktree add`; dependency installs stay incremental in the build directory (SC-004)

**Constraints**:
- never write, switch or reset in a worktree debaser does not own (FR-005, FR-008)
- old patch lists and old stopped runs keep working (FR-014, FR-015)
- JSON output only grows (new fields), so scripts keep parsing

**Scale/Scope**: about 10 source modules touched, 1 new module, ~6 new integration tests plus updates to existing ones whose expectations assume an in-place build

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template, so there are no project gates to check. The practices the repository follows anyway apply: integration tests against real git repositories for every user story, no new dependencies, and the behavior contract (`docs/behavior-contract.md`) kept green. **PASS** (no violations; re-checked after design: PASS).

## Project Structure

### Documentation (this feature)

```text
specs/002-build-worktree/
├── plan.md              # This file
├── research.md          # Phase 0: decisions
├── data-model.md        # Phase 1: patch list, run state, result and JSON additions
├── quickstart.md        # Phase 1: end-to-end validation
├── contracts/
│   └── cli.md           # Phase 1: command output and JSON changes
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── tree.ts          # NEW: resolve, validate, create the build directory; main worktree; describe for status
│   ├── patchlist.ts     # optional `tree` field: parse, keep as written, save
│   ├── runstate.ts      # RunState.tree (absolute path of the build directory)
│   └── context.ts       # Context.home: the worktree debaser was started from (ctx.repo becomes the build dir for runs)
├── git/
│   ├── worktree.ts      # mainWorktree(cwd), worktreeAt(cwd, path); removeWorktree reused to drop a stale registration
│   └── git.ts           # modifiedFiles(cwd) for the listed refusal
├── run/
│   ├── build.ts         # resolve the tree before preflight; drop the user-checkout checks; start point from the tree
│   ├── resume.ts        # continue: repoint ctx.repo to run.tree (or the legacy worktree)
│   ├── rollback.ts      # rollback: same; never touch the user's checkout
│   ├── common.ts        # stepVars/installPath: resolve() so absolute output/install paths work
│   ├── finish.ts        # build output path: resolve() (FR-010)
│   ├── accept.ts        # DEBASER_ARTIFACT: resolve() (FR-010)
│   └── stop.ts          # stop lines and agent prompts name the build directory (FR-011)
├── report/handoff.ts    # handoff names the build directory (FR-011)
├── prompts/handoff.md   # `{{tree}}` line
├── report/report.ts     # result.json `tree`
├── cli/commands/
│   ├── build.ts         # print build dir + patch list once
│   ├── list.ts          # config header + json.config
│   ├── status.ts        # config header, build-dir state, json.config / json.tree
│   └── recipe.ts        # layer sources + json.layerSources
├── views/config.ts      # NEW: configHeader renderer shared by list and status
├── views/recipe.ts      # layer sources on the layers line
└── cli/usage.ts         # mention the build directory
tests/integration/
├── tree.test.ts         # NEW: US1, US2, US4, US5 and the edge cases
├── config.test.ts       # NEW: US3
└── (existing)           # expectations that assumed an in-place build follow the build directory
docs/, README.md         # build directory and configuration display
```

**Structure Decision**: one new module, `src/core/tree.ts`, owns the build directory's whole lifecycle (resolve, validate, create, describe). Commands call it at their start and then swap `ctx.repo`, so the run machinery (`mergeloop`, `verifyloop`, `accept`, `harness-*`, `finish`) stays unchanged.

## Design

### Resolving the build directory (`src/core/tree.ts`)

- `mainWorktree(cwd)` (in `src/git/worktree.ts`): the first entry of `git worktree list --porcelain` (realpath'd).
- `treePath(ctx)`: `list.tree` resolved against the main worktree, else `<dirname(main)>/<basename(main)>-debaser`. `recorded` tells whether it came from the list.
- `inPlace`: realpath(treePath) == realpath(main worktree).
- `inspect(ctx)` returns `{path, recorded, inPlace, exists, ours, branch: string | null, modified: string[]}` (data-model.md; `branch` is null when detached or missing), where `ours` means `git -C path rev-parse --git-common-dir` resolves to this repository's common directory and `path` is that worktree's top level. `status` and `list` use it read-only.
- `prepare(ctx)` is called by `build` (after its existing refusals and `preflight`, so none of them leaves a created directory behind) and by `rollback` without a stopped run. It refuses (Explained, nothing changed), in this order:
  1. the path exists and is not `ours` (foreign directory, or another repository);
  2. the integration branch is checked out in a worktree other than the build directory (an entry at the build directory's own path, live or stale, does not count). The message names that worktree; when it is the main worktree, the FR-016 wording from contracts/cli.md is used;
  3. the tree exists and is not on the integration branch. A detached HEAD is accepted only while `refs/heads/<branch>` does not exist: that is debaser's own state (a tree created before the first build, or after a first run's rollback), and there is no branch to switch back to. A detached HEAD while the branch exists means the user switched it, and is refused (spec edge case);
  4. the tree has modified tracked files, listing them (at most 10, then "and N more").

  If the directory is missing, it drops only the build directory's own stale registration (`removeWorktree(ctx.home, path)`, which never touches other worktrees' entries; FR-008, FR-009), then runs `git worktree add <path> <branch>` when the integration branch exists, or `git worktree add --detach <path> <upstream ref or HEAD>` otherwise. It says so through `ctx.progress`, and when the path was not recorded, writes `tree` (relative `../<name>-debaser` for the default) to the patch list.
- In-place mode keeps today's behavior: refusals 2 (another worktree holds the branch) and 4 (the clean check) apply to the main worktree, refusals 1 and 3 are skipped (the main checkout may sit on any branch; `checkout -B` switches it as before), and nothing is created.

### Repointing the run

- `Context` gains `home` (the worktree debaser was started from, `git.repoRoot(cwd)`). `ctx.repo` keeps meaning "the checkout runs work in": `build` sets `ctx.repo = tree.path` after `prepare`. `continue` and `rollback` set it from `run.tree`, or for a legacy run from `checkedOutIn(home, list.branch)` (FR-014). `build`, `resume` and `rollback` each destructure `const { repo } = ctx` on their first line today; that line moves after the swap. A missing `run.tree` directory makes `continue` refuse with a pointer to `rollback` (a run already in the `rollback` phase is handed to `rollback` first). `rollback` then works ref-only: it drops the tree's stale registration (`removeWorktree(ctx.home, run.tree)`; git refuses `branch -f`/`branch -D` on a branch held by a registered worktree, even a missing one), `git branch -f` back to the start tip (or deletes the branch), then clears the run.
- `RunState.tree` is written at run start. `startHead`/`startBranch` come from the tree, so `installNeeded(ctx.repo, …, run.startHead)` compares within the build directory (SC-004). A new tree's first install runs because its marker (`node_modules`) is missing.
- `build.ts` drops `git.isClean(repo)` and `worktreeWith(repo, branch)` on the started-from checkout; `prepare` covers both on the tree.
- `rollback` without a run (`-prev` restore) calls `tree.prepare(ctx)` (the same refusals as `build`, FR-007; a missing directory is recreated from the branch) and sets `ctx.repo` to it. Its clean check is refusal 4.
- `stepVars`/`installPath` (`src/run/common.ts`), the build output in `finish.ts` and `DEBASER_ARTIFACT` in `accept.ts` switch from `join` to `resolve`, so an absolute `artifact.output`/`artifact.install` is used as is (FR-010).
- What already follows the swap: the agent hints' `run it: cd <ctx.repo> && …` (`stop.ts` `agentHint`, `conflictHint`), the harness cwd, and every helper in `fetch.ts`, `finish.ts`, `live.ts`, `rebase-phase.ts` and `report.ts`, which read `ctx.repo` at call time. What does not: the stop lines (`resolve the conflicts, git add the files, then continue`, `fix it in the working tree …`) name no directory, the prompt files (`fix-conflict.md`, `fix-<step>.md`) name none either, and `{{checkout}}` in `handoff.md` is the patch's own branch, not the build checkout. FR-011 therefore needs: a `  build directory: <ctx.repo>` line in `stop()` (and in `resume`'s "still has unmerged files" stop), a sentence naming `ctx.repo` in both prompt epilogues in `stop.ts`, and a `- Build directory: {{tree}}` line in `handoff.md` filled from `ctx.repo` in `report/handoff.ts`.
- `debaser rebase` is unchanged: it never touches the integration branch and keeps `ctx.repo` = the started-from worktree.

### Configuration display

- A shared `configInfo(ctx)` returns `{dir, patchList, localRecipe: path | null, tree: {path, recorded, exists, inPlace, branch, modified}}`.
- `list` and `status` text: a two-line header before today's output:

  ```
  config  <dir>/patches.json  (local recipe: <path> | none)
  build   <tree path>  [not created yet | missing | on <other> | N modified]
  ```

  JSON: `config` object on both. `status --json` also carries `tree` state (FR-022).
- `recipe`: the layer line shows each layer with its source: `generic:bun-ts (built-in) < project:tals/corgi (built-in) < repo .debaser/recipe.toml at upstream 1a2b3c4 < local <dir>/recipe.toml`. JSON: `layerSources: {<id>: {kind: "built-in" | "repo" | "local", path?, commit?}}`.
- `build`: right after `tree.prepare`, `ctx.progress("build directory <path>; patch list <dir>/patches.json")`. It reaches the plain log and the live view's log. `result.json` gets `tree`.

## Complexity Tracking

No constitution violations. Two choices add some complexity, both justified by the spec: the legacy-run fallback (FR-014), and in-place mode (US5), which keeps the old code path alive instead of deleting it.
