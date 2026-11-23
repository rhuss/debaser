# Feature Specification: Dedicated build worktree and visible configuration

**Feature Branch**: `002-build-worktree`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: brainstorm `brainstorm/01-build-worktree.md`. Approach A: one permanent linked worktree per project that holds the integration branch, its path recorded in debaser's configuration, by default next to the project checkout (`../<project>-debaser`) and created by the first build. `build`, `rebase`, `continue` and `rollback` work in it and never switch, reset or dirty-check the user's own checkout. It may be the checkout itself (CI). debaser refuses when the integration branch is checked out in a worktree it did not create. An existing integration branch migrates without a rebuild. Stops and agent prompts point at the build directory. Configuration display: `list` and `status` show a header with the data directory, `patches.json`, the local `recipe.toml` and the build directory; `recipe` names each layer's source; a build prints the build directory and configuration path at its start; `--json` carries the same paths. Paths only.

## Context

Today `debaser build` works in whatever checkout it is started from: it checks out the integration branch there, resets it to upstream, merges the patches and leaves the checkout on that branch. Two refusals follow from that, and both hit a real project (corgi) on the same afternoon:

- "tracked files have uncommitted changes": an unrelated edit to `AGENTS.md` in the user's checkout blocked the build.
- "debaser is checked out in another worktree … switch it away first": a leftover agent-session worktree held the integration branch.

debaser's data directory (patch list, local recipe, run state, reports) already lives in the repository's shared git directory, so it is the same from every worktree. Only the checkout the build works in depends on where debaser is started. debaser also never says which files it read: `debaser recipe` prints layer ids such as `generic:bun-ts < project:tals/corgi`, and no command shows the data directory or the patch list's path.

## Clarifications

### Session 2026-11-22

- Q: When debaser records the default build directory in the patch list, should it store the path relative to the main checkout or as an absolute path? → A: Relative to the main worktree (`../corgi-debaser`), so moving or syncing the whole project directory keeps it valid. A path the user sets is stored as given.
- Q: Should the installed artifact (`artifact.install`) be written in the build directory or in the user's own checkout? → A: In the build directory. An absolute `artifact.install` path is used as is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build without touching my checkout (Priority: P1)

A developer keeps working in their project checkout: they edit files, sit on a feature branch, run a dev server. They start `debaser build` from that checkout. The build runs in a separate build directory next to the project, holding the integration branch. When it finishes, the developer's checkout is exactly as it was: same branch, same uncommitted edits, no files changed.

**Why this priority**: This is the problem that triggered the feature. Without it, every build requires a clean checkout and leaves the developer on the integration branch.

**Independent Test**: In a project with a patch list, modify a tracked file and check out a feature branch in the main checkout, run `debaser build`, and verify that the build succeeds in the build directory while the main checkout's branch, HEAD and modified files are unchanged.

**Acceptance Scenarios**:

1. **Given** a project whose main checkout has a modified tracked file and is on a feature branch, **When** the user runs `debaser build` there, **Then** the build succeeds, and the main checkout still has the same branch checked out, the same HEAD and the same modification.
2. **Given** a project without a build directory yet, **When** the user runs `debaser build` for the first time, **Then** debaser creates the build directory at `../<project>-debaser` (beside the main checkout), records its path in the patch list and builds there.
3. **Given** a build directory exists, **When** the user runs `debaser build` from the main checkout, from the build directory itself, or from any other worktree of the project, **Then** each run builds in the same build directory with the same result.
4. **Given** a successful build, **When** the user opens the build directory, **Then** it holds the integration branch with the merged patches and the build output, ready to try.

---

### User Story 2 - Stops, continue and rollback in the build directory (Priority: P1)

A build stops on a merge conflict or a failing step. The developer is told where to fix it: in the build directory. They fix it there and run `debaser continue` from wherever they are. If they give up, `debaser rollback` restores the previous build in the build directory, again without touching their own checkout.

**Why this priority**: A build that moves to its own directory but still sends the user to the wrong place on a stop would be worse than today. Stops are a normal part of debaser's workflow.

**Independent Test**: Make two patches conflict, run `debaser build` from the main checkout, check that the stop message, the handoff and the agent prompt name the build directory, resolve the conflict there, run `debaser continue` from the main checkout, and check that the run finishes. Repeat with a stop followed by `debaser rollback`.

**Acceptance Scenarios**:

1. **Given** a build that stops on a merge conflict, **When** the stop is reported, **Then** the message, the conflict prompt for an agent and its "run it" hint all point at the build directory.
2. **Given** a stopped run whose conflict was resolved in the build directory, **When** the user runs `debaser continue` from the main checkout, **Then** the run resumes in the build directory and finishes.
3. **Given** a stopped run, **When** the user runs `debaser rollback`, **Then** the integration branch in the build directory returns to the previous build (or upstream on a first run), and the user's own checkout is not switched, reset or checked.
4. **Given** a step that fails and a harness configured, **When** the harness is asked for a fix, **Then** the harness works in the build directory, and the fix commit lands on the integration branch there.

---

### User Story 3 - See which configuration debaser uses (Priority: P2)

A developer wants to know which files debaser read: where the patch list lives, whether a local recipe override exists, where each recipe layer came from and where the build directory is. `debaser list`, `status` and `recipe` show it, a build log shows it once at the start, and `--json` output carries it for scripts.

**Why this priority**: It makes debaser's behavior explainable, especially now that the build happens in another directory. It is useful on its own but not blocking.

**Independent Test**: In a project with a local `recipe.toml`, run `debaser list`, `debaser status`, `debaser recipe` and `debaser build`, plus the `--json` variants, and check that the data directory, the patch list path, the local recipe path and the build directory appear, and that every recipe layer names its source.

**Acceptance Scenarios**:

1. **Given** a project with a patch list, **When** the user runs `debaser list` or `debaser status`, **Then** the output starts with the data directory, the patch list's path, the local recipe's path (or "none") and the build directory's path (or where it will be created).
2. **Given** a recipe made of a built-in generic recipe, a built-in project recipe, a recipe committed in the project's repository and a local override, **When** the user runs `debaser recipe`, **Then** each layer is shown with its source: "built-in" for the shipped recipes, the committed file's path and the upstream commit it was read from, and the local override's absolute path.
3. **Given** a build, **When** it starts, **Then** its plain log (and the live view's log) shows the build directory and the patch list's path once.
4. **Given** `--json` on `list`, `status` or `recipe`, **When** the output is parsed, **Then** it contains the same paths as fields.

---

### User Story 4 - Existing projects move over without a rebuild (Priority: P2)

A developer already uses debaser: the integration branch exists, the last successful build is on it, and their main checkout may still be on that branch because older builds left it there. After updating debaser, the next `debaser build` moves the integration branch into the new build directory and carries on as before.

**Why this priority**: Without a smooth migration, every existing user hits an error or loses their last build on the first run after the update.

**Independent Test**: Run a build with the old behavior so the main checkout is left on the integration branch, switch the main checkout back to the default branch, run `debaser build`, and check that the build directory is created from the existing integration branch and that `debaser-prev`, reports, timings and rollback keep working.

**Acceptance Scenarios**:

1. **Given** an existing integration branch and no recorded build directory, **When** the user runs `debaser build`, **Then** debaser creates the build directory from the existing branch, records its path and continues with a normal build. The previous build stays available for rollback.
2. **Given** the main checkout is on the integration branch, **When** the user runs `debaser build`, **Then** debaser refuses without changing anything, says the main checkout holds the integration branch, and says how to switch it away.
3. **Given** the integration branch is checked out in a worktree debaser did not create (for example a leftover agent session), **When** the user runs `debaser build`, **Then** debaser refuses without changing anything and names that worktree's path.

---

### User Story 5 - Build in place for CI (Priority: P3)

A CI job has a single checkout and no sibling directory to write to. The patch list records the checkout itself as the build directory, and debaser builds in place as before.

**Why this priority**: It keeps debaser usable in single-checkout environments without a separate mode.

**Independent Test**: Record the main checkout's own path as the build directory, run `debaser build`, and check that it builds in that checkout.

**Acceptance Scenarios**:

1. **Given** the recorded build directory is the main checkout, **When** the user runs `debaser build`, **Then** debaser builds there, with the same clean-tree requirement as before, because the user's checkout and the build directory are the same.

---

### Edge Cases

- **The build directory has modified tracked files** (the user tried something there): debaser refuses to start a build or a rollback with no stopped run, names the modified files and says to commit, stash or discard them. Untracked files such as `node_modules` or build output never block. While a run is stopped, the changes there are the run's own: `continue` uses them and `rollback` discards them (FR-007).
- **The recorded build directory was deleted or moved by hand**: the next build recreates it at the recorded path and says so. git's stale worktree entry is pruned first. debaser does not follow a moved copy; the user can delete it.
- **The recorded path exists but is not a worktree of this repository** (another project, a plain directory): debaser refuses and names the path. It never writes into a directory it does not own.
- **The build directory sits on another branch or a detached HEAD** (the user switched it): debaser refuses and says to switch it back to the integration branch. It never switches branches in the build directory on its own, except when creating it.
- **A run is stopped and the build directory is gone**: `continue` refuses and says to run `rollback`. `rollback` resets the integration branch without the directory, then recreates it on the next build.
- **The default path `../<project>-debaser` already exists** and is not this project's worktree: the first build refuses, names the path and says how to record another one.
- **The data directory is outside the repository** (`--dir` or `DEBASER_DIR`): the default build directory still sits beside the main checkout. The recorded path is stored in that data directory's patch list.
- **Two data directories for one repository** (`--dir`, each with its own patch list and integration branch): both default to the same path. The second one's first build finds the directory on another branch, refuses (FR-007) and says to record a separate path in its patch list.
- **debaser is started inside a linked worktree**: "project" always means the repository's main worktree, so the default path is the same no matter where debaser is started.
- **An own branch that is a patch is checked out in the user's checkout**: unchanged rules apply. The rebase phase handles it as today (`--in-worktree` or skip). The build never checks out that branch in the user's checkout.
- **A second debaser command runs while a build runs**: the existing per-repository lock still refuses it, wherever it is started.

## Requirements *(mandatory)*

### Functional Requirements

**Build directory**

- **FR-001**: Each project MUST have exactly one build directory, a working tree of the project's repository that holds the integration branch. Every command that changes the integration branch (`build`, `continue`, `rollback`) MUST do so only in that directory. The build's rebase phase keeps rebasing own branches in throwaway worktrees as today; it rebases one in the worktree that has it checked out (the user's checkout included) only with `--in-worktree`, as before.
- **FR-002**: The build directory's path MUST be recorded in the patch list. When none is recorded, the default MUST be `<parent of the main worktree>/<main worktree's directory name>-debaser`.
- **FR-003**: When the recorded or default build directory does not exist, `build` MUST create it as a linked worktree of the project's repository, holding the integration branch. It MUST be created from the existing integration branch when there is one, and from the upstream tip otherwise. The path MUST be recorded in the patch list when it is created, relative to the main worktree when debaser chose the default.
- **FR-004**: The user MUST be able to set the build directory's path (absolute, or relative to the main worktree) in the patch list, and debaser MUST keep it as written. Setting it to the main worktree's own path MUST make debaser build in place.
- **FR-005**: debaser MUST NOT check out, reset, merge into, commit to, or check for modifications in the worktree it was started from, unless that worktree is the build directory.
- **FR-006**: debaser MUST work the same when started from the main worktree, from the build directory or from any other worktree of the project. All of them share one data directory and one build directory.
- **FR-007**: Before changing the integration branch, debaser MUST refuse, without changing anything, when:
  - the build directory has modified tracked files (listing them),
  - the build directory is not on the integration branch,
  - the recorded path exists but is not a worktree of this repository, or
  - the integration branch is checked out in any other worktree (naming its path).

  The modified-files check applies only when no run is stopped. While a run is stopped, the build directory's tracked changes belong to that run: `continue` takes the user's conflict resolutions and edits from there, and `rollback` discards them as part of undoing the run.
- **FR-008**: debaser MUST NOT remove, move or switch branches in any worktree it did not create. It MUST NOT delete the build directory either; removing it is left to the user.
- **FR-009**: When the recorded build directory no longer exists, the next `build` MUST recreate it at the recorded path (after pruning git's stale entry for it) and say so in its output.

**Runs, stops and recovery**

- **FR-010**: All recipe steps, acceptance checks, harness calls and installs of a build MUST run in the build directory. The build output path and the installed-artifact path MUST be resolved against the build directory, unless the recipe gives an absolute path. A run's start point (HEAD, branch and installed artifact) MUST be taken from the build directory, and whether the install step runs MUST be decided there (against the build directory's HEAD before the run and its install marker), so the first build in a new build directory installs dependencies and later builds reinstall only when the install triggers changed.
- **FR-011**: Every stop message, handoff, conflict or fix prompt, and "run it" hint MUST name the build directory as the place to resolve the problem.
- **FR-012**: `continue` MUST resume a stopped run in the build directory, regardless of where it is started. When the build directory is missing, it MUST refuse and point to `rollback`.
- **FR-013**: `rollback` MUST reset the integration branch in the build directory (to its previous build, or upstream after a first run) and MUST NOT switch or check out anything in the user's own checkout.
- **FR-014**: A run stopped before this change (its run state records no build directory) MUST still be continuable and rollable-back as before, in the worktree that has the integration branch checked out, whichever worktree `continue` or `rollback` is started from. The FR-016 refusal MUST NOT apply to such a run. When no worktree has the integration branch checked out, debaser MUST refuse and say to check it out again where the run was started. The build directory takes over from the next new run.

**Migration**

- **FR-015**: When the integration branch exists and no build directory is recorded, the first `build` MUST create the build directory from that branch, with no new build from scratch beyond the normal run. `debaser-prev`, reports, timing history and rollback MUST keep working.
- **FR-016**: When the main worktree holds the integration branch at that point, `build` MUST refuse without changing anything, say that the main checkout holds the integration branch, and say how to switch it to another branch.

**Configuration display**

- **FR-017**: `list` and `status` MUST start their human output with the data directory, the patch list's path, the local recipe override's path (or "none") and the build directory's path. A build directory not created yet MUST be marked as such.
- **FR-018**: `recipe` MUST show each layer together with its source:
  - "built-in" for recipes shipped with debaser,
  - the committed file's repository path and the upstream commit it was read from, for the project-repository layer,
  - the absolute path, for the local override.
- **FR-019**: At the start of a build, debaser MUST print the build directory and the patch list's path once. They MUST appear in the plain log and in the live view's log.
- **FR-020**: The `--json` output of `list`, `status` and `recipe` MUST carry the same paths as fields, and a build's `result.json` MUST record the build directory it ran in.
- **FR-021**: The configuration display MUST show paths only, with no file contents, timestamps or hashes (apart from the upstream commit in FR-018).
- **FR-022**: `status` MUST say when the build directory is missing, is not on the integration branch, or has modified tracked files, and its `--json` output MUST carry the same state as fields.

### Key Entities

- **Build directory**: the one working tree per project that holds the integration branch. Attributes: path (recorded in the patch list), whether it exists, the branch it has checked out, and whether it has modified tracked files. Relationship: a linked worktree of the project's repository, sharing objects, refs, remotes and conflict resolutions with every other worktree.
- **Main worktree**: the repository's primary checkout. It defines the project name and the default location of the build directory.
- **Configuration sources**: the data directory, the patch list, the local recipe override and each recipe layer's origin, all shown as paths by the configuration display.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of builds started from a checkout with modified tracked files or another branch checked out, the build proceeds, and that checkout's branch, HEAD and file contents are byte-for-byte unchanged afterwards.
- **SC-002**: A build started from the main checkout, the build directory or a third worktree produces the same integration branch tip for the same upstream and patches.
- **SC-003**: For an existing project, the first build after the update completes without the user running any git command beyond switching the main checkout off the integration branch (when it is on it), and the previous build remains restorable with `rollback`.
- **SC-004**: The second and later builds in the build directory do not reinstall dependencies when the install triggers have not changed.
- **SC-005**: A user can find the patch list, the local recipe and the build directory on disk using only the output of `debaser list` (or `status`), with no documentation.
- **SC-006**: Every stop (conflict, step failure, acceptance failure) names the build directory as the place to fix it.

## Assumptions

- The project is a git repository with a main worktree. The build directory is a linked worktree of it, so own branches, fetched patch refs, backups and conflict resolutions are shared with no extra copying.
- The installed artifact (recipe `artifact.install`) moves from the user's checkout to the build directory, because that is where the build lives now. A recipe that needs the old location can give an absolute path. The first build after the update installs into the build directory, and an artifact installed in the user's checkout by an older version is left where it is.
- Modified tracked files in the build directory block a run, the same rule the user's checkout has today. The reason is that they are most likely an experiment the user wants to keep. Untracked files (dependencies, build output) never block.
- A build directory deleted by hand is recreated on the next build rather than treated as an error, because it holds no state beyond the integration branch, which lives in the shared repository.
- The patch list gains one optional field for the build directory. Patch lists without it keep working.
- `debaser rebase` (rebasing own branches only) does not use the build directory, because it never touches the integration branch. Its rules for own branches checked out in worktrees are unchanged.
- Removing the build directory stays with the user (`git worktree remove`). debaser never deletes it.
- The per-repository lock, retention of reports, and the integration branch's name and backup (`<branch>-prev`) are unchanged.
