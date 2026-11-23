# Brainstorm: A dedicated build worktree and visible configuration

**Date:** 2026-11-22
**Status:** spec-created (specs/002-build-worktree, merged in 8070090)

## Problem Framing

`debaser build` runs in whatever checkout it is started from. It runs `git checkout -B <integration branch>` there (`src/run/build.ts:113`) and leaves the checkout on that branch. Two things follow from that:

- A modified tracked file anywhere in the checkout stops the run ("tracked files have uncommitted changes").
- The integration branch must not be checked out in any other worktree ("debaser is checked out in another worktree … switch it away first").

Both happened in corgi on the same afternoon: once for an edited `AGENTS.md`, once for a leftover `.claude/worktrees/debaser` session worktree. The user wants debaser to work no matter where it is started, with the integration branch kept in one prominent directory next to the project (for example `corgi-debaser/` beside `corgi/`), so the build is easy to open and try.

Separately, debaser never says which configuration it read. The data directory (`<git-common-dir>/debaser`) is already the same from every worktree, but `list`, `status` and `recipe` show only layer ids such as `generic:bun-ts < project:tals/corgi`, never file paths.

Success: running `debaser build` from the main checkout, the build directory or any other worktree of the project gives the same result. Your own checkout is never switched, reset or checked for dirty files, and every command shows which files it read.

Failure even if it technically works: debaser takes over or moves a branch out of a worktree it did not create; the first build after the change rebuilds everything from scratch; or each build starts with a full install.

## Approaches Considered

### A: One permanent linked worktree, recorded in the config
- Pros: shares objects, remotes, rerere and own branches with the main checkout, so own-branch rebases, `--push` and `debaser-prev` keep working unchanged. `node_modules` and `dist/` persist between runs, so installs stay incremental. It gives the user the stable directory they asked for. Worktree helpers already exist (`src/git/worktree.ts`).
- Cons: debaser now manages a worktree's lifecycle (create it, notice it missing or moved, refuse when someone else holds the branch).

### B: A throwaway worktree per run
- Pros: simplest to make correct; every run starts clean, nothing can drift. debaser already does this for own-branch rebases.
- Cons: a full install on every build (corgi: `bun install` plus the native build), and no directory stays around to open and try. Works against the reason for the change.

### C: Build in place, but stash and switch back
- Pros: smallest change.
- Cons: editors, dev servers and agent sessions watch the files flip during a long build; a stash pop can conflict; still no prominent directory.

### Dropped: a separate clone next to the project
The integration branch and the user's own branches would live in two repositories, which breaks own-branch rebases and the `debaser-prev` backup.

## Decision

Approach A: one permanent linked worktree per project, holding the integration branch. Its path is recorded in debaser's configuration, and every command that builds or changes the integration branch works directly in it.

## Key Requirements

Stated by the user:
- There is exactly one build directory per project, and it holds the integration branch.
- Its path is recorded in debaser's configuration, so debaser can work directly in it.
- It sits next to the project checkout (for example `corgi-debaser/` beside `corgi/`), easy to open.
- debaser shows which configuration it picked up, as file paths.

Proposed by Claude and accepted by the user:
- Default path `../<project>-debaser`, recorded in `patches.json`, and the user can change it.
- The first `build` creates the worktree when it is missing and records the path; no separate setup command.
- The recorded directory may be the project checkout itself, which covers CI and single-checkout setups without a separate mode.
- debaser can be started from the main checkout, the build directory or any other worktree of the project; all share `.git/debaser`.
- `build`, `rebase`, `continue` and `rollback` work in the build directory. Your own checkout is never switched, reset or checked for dirty files.
- Stops (conflicts, failing steps, acceptance failures), their messages and the agent prompts point at the build directory.
- `rollback` resets the integration branch in the build directory and no longer switches your checkout.
- If the integration branch is checked out in a worktree debaser did not create, debaser refuses and names that worktree. It never moves a branch out of a foreign worktree.
- Migration: an existing integration branch becomes the new build worktree on the first build after the update, with no rebuild from scratch. If the main checkout is on the integration branch, debaser stops and asks the user to switch it away first. `debaser-prev` and the reports keep working.
- Configuration display:
  - `list` and `status` start with a header showing the data directory, `patches.json`, the local `recipe.toml` (or "none") and the build directory.
  - `recipe` names each layer with its source: "built-in", the committed file's path in the repo, or the local override's path.
  - A build prints the build directory and config path once at the start, so logs show what a run used.
  - `--json` carries the same paths as fields.
  - Paths only; no timestamps or hashes.

## Open Questions
- Tracked changes inside the build directory (the user tried something there): refuse like today, or reset them because debaser owns the directory?
- What happens when the recorded directory was moved or deleted by hand: recreate it at the recorded path, or refuse and ask?
- The name and shape of the config field in `patches.json`, and whether it needs a schema version bump.
- How `--dir` / `DEBASER_DIR` (a data directory outside the repository) interacts with the default build-directory path.
- Whether `status` should warn when the build directory has drifted (an extra commit, the wrong branch checked out).
- Whether `debaser remove` or a new subcommand ever deletes the build worktree, or the user does that with `git worktree remove`.
