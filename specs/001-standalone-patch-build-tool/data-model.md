# Data Model: debaser v1

All persistent data lives in debaser's directory (`<git-common-dir>/debaser/` by default, see research R4), except refs (in the repository) and the installed artifact (in the checkout, at the recipe's install path).

## Directory layout

```text
<dir>/
├── patches.json            # PatchList (FR-001), written atomically
├── recipe.toml             # optional local override recipe (layer 4)
├── trust.json              # TrustStore (FR-042)
├── run.json                # RunState, present only while a run is running or stopped
├── lock                    # RunLock (FR-001b), present while a mutating command runs
├── timings.json            # TimingHistory (FR-048)
├── manifest.json           # BuildManifest (FR-045), rewritten before each build
├── work/                   # throwaway worktrees: isolated-<name>/, rebase-<slug>/
└── reports/
    ├── <YYYYMMDD-HHMMSS>[-n]/   # one per run (UTC)
    │   ├── report.md, result.json
    │   ├── handoffs/<patch-slug>.md
    │   ├── fix-<step>.md
    │   ├── steps/<step>.log, <step>-flaky-N.log, <step>-failed-N.log, after-build.log
    │   ├── acceptance/<patch-slug>.log
    │   ├── prompts/NN-<task>.md|.log|.jsonl
    │   ├── isolated/<name>-<step>.log
    │   └── rebase/<slug>-<step>.log, <slug>-push.log
    ├── rollback-<stamp>/       # rollbacks without a stopped run
    └── latest -> <newest run>
```

Retention: the 10 newest run directories and, separately, the 10 newest `rollback-*` directories (FR-047).

## PatchList (`patches.json`)

| Field | Type | Rules |
|---|---|---|
| `version` | `1` | A higher version is refused (written by a newer debaser). |
| `upstream` | `{repo: "owner/repo", remote: string, branch: string}` | Set by the first `add` (FR-001a). `remote` defaults to `upstream`. |
| `branch` | string | Integration branch, default `debaser`; must be a valid ref name and differ from `upstream.branch`. |
| `recipe` | string? | Names a generic recipe (FR-039b). |
| `rebase` | `"all" \| "conflicting" \| "off"` | Default `all`. |
| `harness` | `HarnessConfig?` | |
| `patches` | `Patch[]` | Order = merge order. |
| `retired` | `RetiredPatch[]` | |

### Patch

| Field | Type | Rules |
|---|---|---|
| `source` | `Source` | Unique across `patches`; must not be the integration branch or its `-prev` backup. |
| `description` | string | Defaults to the PR title, else the branch name. |
| `added` | ISO date | |
| `pin` | string? | Full commit SHA (FR-053). Pinned patches are never rebased. |
| `acceptance` | `AcceptanceCheck?` | FR-028. |

`Source` is one of:

- `{kind: "branch", name}`: an own local branch.
- `{kind: "pr", repo: "owner/repo", number}`: a PR on upstream or any other GitHub repository.
- `{kind: "fork-branch", repo?: "owner/repo", url?: string, branch}`: exactly one of `repo` or `url`; `url` must not carry credentials.

Ownership (FR-032) is derived, not stored: a `branch` source is own; a `pr` or `fork-branch` is own when its head repository equals the repository `origin` pushes to (compared by repository, however the URL is spelled).

### RetiredPatch

`Patch` plus `retired` (ISO date) and `reason` (non-empty).

### AcceptanceCheck

| Field | Type | Default |
|---|---|---|
| `run` | string[] | required; placeholders `{output}`, `{root}` |
| `exit` | integer | `0` |
| `match` | string? | regular expression, searched in combined stdout and stderr |
| `timeout` | seconds | `300` |

### HarnessConfig

| Field | Type | Default |
|---|---|---|
| `command` | string[] | required; `{prompt_file}` is replaced by the prompt path |
| `kind` | `"claude" \| "codex" \| "pi" \| "opencode" \| "plain"` | `plain` |
| `timeoutSeconds` | integer | 900 |
| `attempts` | integer | 3 |
| `tasks` | `{conflict?, check?, acceptance?, rebase?: {command, kind}}` | each falls back to the top-level harness (FR-023) |

The total fix bound is `attempts × (steps + acceptance checks)` (FR-021).

## Recipe (TOML, layered)

| Key | Type | Notes |
|---|---|---|
| `name` | string | Built-in recipes only. |
| `extends` | string? | Only in the lowest non-generic layer, naming a generic recipe (FR-039a). |
| `detect` | `string[]` | Generic recipes only: files whose presence selects the recipe. |
| `[install]` | `{step, triggers: string[], marker?: string}` | `step` names a step; it runs when a trigger changed since the run's start head or `marker` is missing. |
| `[artifact]` | `{output?: string, install?: string}` | Build output path (relative to the tree) and installed copy path (relative to the checkout). |
| `[[steps]]` | `{name, run: string[], parser?, timeout?, before?, after?, tests?: string[]}` | Merged by `name`. `tests` is what `{tests}` stands for on a full run (all tests when absent). |
| `steps_replace` | bool | Replaces the inherited step list. |
| `after_build` | string[]? | Runs after a fully successful run (FR-010). |
| `[prompts]` | `{conflict?, check?, acceptance?, rebase_conflict?, rebase_check?, handoff?}` | Paths (project-repo and local layers) or inline text replacing the shipped templates. |
| `project_name` | string? | Used in prompts; defaults to the upstream repository name. |
| `leftovers` | `string[]?` | Globs of temporary files the build leaves (beyond `.*.bun-build`); never committed with a fix. Layers add to each other. |

### EffectiveRecipe

The merged result plus, for every value, the layer it came from (`generic:<name>`, `project:<owner/repo>`, `repo:.debaser/recipe.toml@<sha7>`, `local`). Printed by `debaser recipe` (FR-044).

## TrustStore (`trust.json`)

`{version: 1, trusted: {"<owner/repo>": {sha256, trustedAt}}}`. A project-repo recipe whose content hash differs is untrusted (FR-042).

## RunState (`run.json`)

Ported from the reference `RunState` with renamed fields where corgi-specific:

| Field | Meaning |
|---|---|
| `kind` | `"rebuild" \| "rebase"` |
| `startedAt`, `reportDir` | |
| `startTip`, `startHead`, `startBranch` | For rollback (FR-016) and the install trigger. |
| `startArtifact` | Path of the saved copy of the installed artifact at run start (`work/artifact.start`). |
| `upstream` | `{ref, tip}` |
| `phase` | `"rebase" \| "merge" \| "verify" \| "accept" \| "report" \| "rollback"` |
| `cursor`, `step`, `attempts`, `calls`, `fixCount` | Loop positions and counters. |
| `plan` | `PlannedPatch[]`: source, resolved commit, skip reason (`merged`, `contained`), warnings (`closed`). |
| `merged` | Patches merged so far with their merge commits. |
| `events` | `{kind, patch?, step?, detail?}[]` (flaky, upstream-broken, skipped, closed-warning...). |
| `conflicts` | `{patch, files, by: "rerere" \| "harness" \| "user"}[]` |
| `fixes` | `{step, commit, by, files, log?, attribution?}[]` |
| `acceptance` | `{patch, result: "pass" \| "fail" \| "flaky" \| "none", log}[]` |
| `stopped` | `{code, snapshot} \| null` |
| `stopFailure` | `{step \| acceptance, head, log, attribution}` |
| `harnessCall` | The call in progress, so `continue` can judge what an interrupted call left. |
| `harnessUsage` | `{call, task, target, attempt, ok, reason, seconds, usage: {input, output} \| null}[]` |
| `timing` | Active time, per-item times, harness time. |
| `rebased`, `rebaseTargets`, `rebaseCursor`, `rebaseStop` | Own-branch rebase progress. |

`Snapshot` maps each path to `"XY:<content hash>"`, used to tell what changed since a stop.

### State transitions

```text
(none) --rebuild--> rebase --> merge --> verify --> accept --> report --> (none, success)
                       |          |          |          |
                       |       stopped(2,5) stopped(3,4,5) stopped(6,5)
                       |          \__________|__________/
                       |                     |
                       |        continue ----+---> back into the stopped phase
                       |        rollback --> rollback --> (none)
(none) --rebase--> rebase --stopped(2)--> continue | continue --skip-branch | rollback
```

A failed reset discards the run (no `run.json`). A signal leaves `run.json` in its current phase.

## RunLock (`lock`)

`{pid, command, startedAt}`; created exclusively; taken over when `pid` is dead (research R12).

## Report (`result.json` and `report.md`)

`result.json` is the machine-readable result (FR-049): `{version: 1, command, outcome: "success" | "stopped" | "failed", exitCode, upstream: {ref, tip, newCommits}, patches: [{source, display, state: "merged" | "skipped-merged" | "skipped-contained" | "not-merged" | "retired", pr?: {state, url}, rebase?: string, merges?: boolean, checks?: string, acceptance?: "pass" | "fail" | "flaky" | "fixed" | "none" | "skipped" | "not run", handoff?: path}], steps: [{name, result: "pass" | "flaky" | "fixed" | "fail" | "skipped" | "not run" | "upstream-broken", log}], harness: {calls, tokens: {input, output} | null}, artifact?: {installed, previous}, report: path}`. `not-merged` is a patch a stopped run had not reached yet; a step is `skipped` when it was not needed (the install step with nothing changed); `skipped` acceptance is a patch skipped as merged or contained, or retired (FR-030).

## Handoff

Markdown prompt from `handoff.md` with `kind` in `rebase`, `build-drift`, `build-clash` (naming the other patches), `acceptance` or `rebase-checks`. One file per affected patch per run (FR-057). Patches whose merges only conflict with each other get a note in the report instead.

## TimingHistory (`timings.json`)

`{version: 1, runs: HistoryRun[]}`, last 20 runs; estimates are the median of the last 5 with outliers dropped (above 3× and more than 5 minutes over). Prompt waiting time is excluded.

## BuildManifest (`manifest.json`)

`{version: 1, upstream: {repo, branch, tip}, commit, fork: url | null, patches: [{source, display, commit, pin?}]}`. The same data is passed as `DEBASER_PATCHES` (the `patches` array as JSON), `DEBASER_FORK_URL`, `DEBASER_COMMIT` and `DEBASER_MANIFEST` (FR-045).

## Refs

| Ref | Holds |
|---|---|
| `refs/debaser/<owner>/<repo>/pull/<n>` | fetched PR heads |
| `refs/debaser/<owner/repo or url-slug>/heads/<branch>` | fetched fork branches |
| `refs/debaser/rebase-backup/<b>` | old tip of a rebased own branch |
| `refs/debaser/rebased/<b>` | rebased tip |
| `refs/debaser/rebase-lease/<b>` | fork tip used as push lease |
| `refs/debaser/rebase-checking/<b>` | tip under check during an in-worktree rebase |
| `refs/debaser/fork/<b>` | last seen fork copy |
| `refs/heads/<branch>`, `refs/heads/<branch>-prev` | integration branch and its previous build |
