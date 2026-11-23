# Research: Dedicated build worktree

## R1: How runs reach the build directory

- **Decision**: repoint `ctx.repo` to the build directory at the start of `build`, `continue` and `rollback`, and keep the started-from worktree as `ctx.home`.
- **Rationale**: every run helper (merge loop, verify loop, acceptance, harness calls, installs, prompts with `{{checkout}}`, handoffs) already takes the checkout from `ctx.repo`. Refs, objects, rerere and remotes are shared across linked worktrees, so git commands that only touch refs work from any of them. One swap at the entry point moves everything, with no change to the run machinery.
- **Alternatives considered**: threading a separate `tree` parameter through every helper (large diff, easy to miss a call site); `process.chdir` (hidden global state, breaks tests that run several worlds in one process).

## R2: Detecting "ours" versus a foreign directory

- **Decision**: a path is the build directory when `git -C <path> rev-parse --show-toplevel` is the path itself (realpath) and `--git-common-dir` resolves to this repository's common directory.
- **Rationale**: it tells apart a plain directory, another repository, a subdirectory of this repository, and a real linked worktree, without parsing `.git` files. macOS `/private` prefixes are handled by `realpath`, as `src/git/worktree.ts` already does.
- **Alternatives considered**: matching the path against `git worktree list` (misses a directory that is a worktree of another repository with the same name, and needs the same realpath care anyway).

## R3: Creating the directory without an integration branch

- **Decision**: `git worktree add --detach <path> <upstream remote-tracking ref, else HEAD>`; the build's existing `checkout -B <branch> <upstream tip>` then creates the branch inside it.
- **Rationale**: the build's reset already does the right thing once it runs in the tree. A first run's rollback (no start tip) returns the tree to its detached start head and deletes the branch, which the existing rollback code does.
- **Alternatives considered**: creating the branch at creation time (duplicates the reset, and leaves a branch behind if the first fetch fails).

## R4: Default path and how it is recorded

- **Decision**: `<dirname(main worktree)>/<basename(main worktree)>-debaser`, recorded as `../<basename>-debaser` (relative to the main worktree) on creation. A user-set value is kept as written.
- **Rationale**: from the clarification (moving or syncing the project keeps it valid). The main worktree is the first `git worktree list` entry, which is the same from every worktree (spec edge case "debaser is started inside a linked worktree").

## R5: Runs stopped before the change

- **Decision**: `run.tree` absent means a legacy run. `continue`/`rollback` use `checkedOutIn(home, list.branch)`, and refuse with a hint when no worktree holds the branch.
- **Rationale**: old runs always left the integration branch checked out in the worktree they ran in, so that worktree is the run's tree. The run state has no path (spec review finding 2).

## R6: Installed artifact location

- **Decision**: `installPath` resolves `artifact.install` against the build directory (`ctx.repo` after the swap), using `resolve` so absolute paths pass through. An artifact an older version installed in the user's checkout is left alone.
- **Rationale**: clarification Q2 and FR-005 (no writes into the user's checkout).

## R7: Configuration display shape

- **Decision**: a two-line text header on `list` and `status`, a `config` object in their JSON, and layer sources on `recipe` (text and `layerSources` in JSON). The layer id formats stay as they are (`generic:<name>`, `project:<owner/repo>`, `repo:<path>@<sha7>`, `local`); the source is derived from the id.
- **Rationale**: JSON output only grows, so existing consumers keep working. Deriving sources from ids needs no change to recipe resolution.
- **Alternatives considered**: a new `debaser config` command (more surface; the user asked to see it where they already look).
