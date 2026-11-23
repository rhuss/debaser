# Data Model: Dedicated build worktree

Additions to the model in `specs/001-standalone-patch-build-tool/data-model.md`. Everything else is unchanged.

## PatchList (`patches.json`)

| Field | Type | Rules |
|---|---|---|
| `tree` | string? | The build directory. Absolute, or relative to the main worktree. Written on first creation as `../<main-worktree-name>-debaser` when absent; a user-set value is kept as written. Must not be empty. Patch lists without it keep working (default path). No version bump: older debaser versions ignore unknown fields. |

## RunState (`run.json`)

| Field | Type | Rules |
|---|---|---|
| `tree` | string? | Absolute, realpath'd build directory the run works in. Written at run start by `build`. Absent means a run from before this change (FR-014): `continue`/`rollback` use the worktree that has the integration branch checked out. |
| `startHead`, `startBranch`, `startArtifact` | (unchanged types) | Now taken from the build directory, not the started-from checkout. |

## BuildDirectory (derived, not stored)

`inspect(ctx)` result, used by `build` (refusals), `status`/`list` (display) and JSON:

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Absolute path (resolved against the main worktree). |
| `recorded` | boolean | The path came from `patches.json` (false: the default, not yet recorded). |
| `exists` | boolean | The directory exists. |
| `ours` | boolean | It is a linked worktree of this repository (top level and common dir match). |
| `inPlace` | boolean | It is the main worktree itself (US5). |
| `branch` | string \| null | Branch checked out there; null when detached or missing. |
| `modified` | string[] | Modified tracked files (empty when missing). |

### Validation and transitions (`build`)

```text
missing ──prune+add──▶ ok (branch or detached)       [records `tree` if not recorded]
exists, not ours ─────▶ refuse (foreign path)
branch held elsewhere ▶ refuse (names worktree; FR-016 wording for the main worktree)
on another branch ────▶ refuse   [detached: accepted only while refs/heads/<branch> does not exist]
modified files ───────▶ refuse (lists files)      [skipped while a run is stopped]
ok ───────────────────▶ ctx.repo := path; run
```

## Report (`result.json`)

| Field | Type | Rules |
|---|---|---|
| `tree` | string | The build directory the run worked in (absolute). |

## Config info (JSON on `list` and `status`)

`config: {dir, patchList, localRecipe: string | null, tree: {path, recorded, exists, inPlace, branch, modified}}`

## Recipe layer sources (JSON on `recipe`)

`layerSources: {<layer id>: {kind: "built-in"} | {kind: "repo", path: ".debaser/recipe.toml", commit: "<sha7>"} | {kind: "local", path: "<dir>/recipe.toml"}}`
