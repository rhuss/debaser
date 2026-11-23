# CLI contract changes: build directory and configuration display

Additions to `specs/001-standalone-patch-build-tool/contracts/cli.md`. Exit codes are unchanged: every new refusal is exit 1 (precondition), and nothing is changed when it happens.

## `build`

- Works in the build directory (patch list `tree`, default `../<main-worktree-name>-debaser`), whichever worktree it is started from.
- First progress lines after the lock:
  - `debaser: creating the build directory <path> from <branch|upstream>` (only when it is created)
  - `debaser: build directory <path>; patch list <dir>/patches.json`
- New refusals (exit 1, nothing changed):

| Condition | Message |
|---|---|
| path exists, not a worktree of this repository | `<path> is not a worktree of this repository; set another path as "tree" in <patches.json>` |
| integration branch in the main worktree | `the main checkout (<path>) has <branch> checked out; switch it away first: git -C <path> switch <upstream.branch>` |
| integration branch in another worktree | `<branch> is checked out in another worktree (<path>); switch it away first` |
| build directory on another branch, or detached while `<branch>` exists | `the build directory <path> has <other or "a detached HEAD"> checked out, not <branch>; switch it back first, or set another path as "tree" in <patches.json>` |
| modified tracked files in the build directory | `the build directory <path> has uncommitted changes in: <files>; commit, stash or discard them first` |

- Removed: the clean-tree and "checked out in another worktree" refusals for the started-from checkout (unless it is the build directory, or in-place mode).

## `continue`

- Resumes in the run's build directory (`run.tree`), or for a run from before this change, in the worktree that has the integration branch checked out.
- New refusal: `the build directory <path> is gone; undo the run with \`debaser rollback\``.
- Stop output gains a line `  build directory: <path>` (every stop: conflict, step failure, acceptance failure, harness give-up), and the agent prompt files name the build directory.

## `rollback`

- Resets the integration branch in the build directory; never checks out anything in the started-from worktree.
- With a stopped run, the build directory's changes are discarded as part of the run (no clean check). Without a run (`-prev` restore), the build directory must be clean.

## `list`, `status` (text)

Three header lines before today's output:

```
data    /…/corgi/.git/debaser
config  /…/corgi/.git/debaser/patches.json  (local recipe: none)
build   /…/corgi-debaser
```

The `build` line adds `(not created yet)`, `(missing)`, `(in place)`, `(on <branch>, not <integration branch>)` or `(N modified files)` as they apply. `status` lists the modified files.

## `list --json`, `status --json`

New top-level `config` object (see data-model.md). `status --json` carries the build directory's state in `config.tree`.

## `recipe`

The layers line names each layer's source:

```
debaser recipe · generic:bun-ts (built-in) < project:tals/corgi (built-in) < repo .debaser/recipe.toml at upstream 1a2b3c4 < local /…/.git/debaser/recipe.toml
```

`--json` adds `layerSources` (see data-model.md).

## `result.json`

New field `tree` (absolute build directory).
