# Tasks: debaser v1, a standalone tool for patched builds

**Input**: Design documents from `specs/001-standalone-patch-build-tool/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Requested. The integration test world (research R9) is central: every story phase starts with its tests, which must fail before the implementation and pass after it.

**Reference implementation**: `REF` = `/Users/rhuss/Development/context-engineering/corgi/.claude/worktrees/custom-build-tool`. Modules are in `REF/scripts/custom_build/`, the behavior suite in `REF/tests/custom_build.test.ts`, and the user docs in `REF/docs/custom-builds.md`. Port **behavior**, not names: no `corgi`, `custom-build` or `CORGI_` strings in `src/` outside `src/recipes/builtin/tals-corgi.toml` (FR-050). Names to use: research.md R10.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1 to US8 from spec.md

---

## Phase 1: Setup

- [X] T001 Create `package.json` (name `debaser`, `"type": "module"`, scripts `test` = `bun test`, `typecheck` = `tsc --noEmit`, `build` = `bun build --compile src/cli/main.ts src/live/worker.ts --outfile dist/debaser`), `tsconfig.json` (strict, `moduleResolution: bundler`, `types: ["bun"]`), `bunfig.toml`, dev deps `@types/bun` and `typescript`; add `dist/` to `.gitignore`
- [X] T002 [P] Add `src/types/assets.d.ts` declaring `*.md` and `*.toml` modules as `string` so `import x from "./f.md" with { type: "text" }` typechecks (research R1)
- [X] T003 Create `src/cli/main.ts` exporting `main(argv: string[], io: IO): Promise<number>` (IO = `{cwd, env, out, err, now?, ask?, color?, columns?, rows?, sink?, live?}` as in `REF/scripts/custom_build/main.ts`) that handles `--version` and `help`, plus a bottom-level `if (import.meta.main)` runner setting `process.exitCode`; verify `bun run build && ./dist/debaser --version` works

---

## Phase 2: Foundational (blocks every story)

- [X] T004 Implement `src/core/errors.ts`: exit code constants exactly as contracts/cli.md (0, 1, 2, 3, 4, 5, 6, 129, 130, 143) and class `Explained` (message plus exit code 1) as in `REF/scripts/custom_build/run.ts`
- [X] T005 [P] Implement `src/core/paths.ts`: resolve the data dir as `--dir` > `DEBASER_DIR` > `<git rev-parse --git-common-dir>/debaser` (absolute), plus helpers for every path in data-model.md "Directory layout"; unit test `src/core/paths.test.ts` (port "the config directory comes from --dir, then the environment, then the checkout")
- [X] T006 [P] Implement `src/core/lock.ts` (`acquire(dir, command)`, `release`): create `<dir>/lock` with exclusive create holding `{pid, command, startedAt}`; refuse with `Explained` naming pid and command; take over when `process.kill(pid, 0)` throws `ESRCH` (research R12); unit test `src/core/lock.test.ts`
- [X] T007 Port `REF/scripts/custom_build/git.ts` to `src/git/git.ts`: `git`, `must`, `Bun.spawnSync`, exit 130/143/129 when a child died of SIGINT/SIGTERM/SIGHUP, `requireVersion("2.38")`
- [X] T008 [P] Port the remaining git helpers from `REF/scripts/custom_build/git.ts` into `src/git/merge.ts` (`mergeNoFF` with `-c rerere.enabled=true -c rerere.autoUpdate=true`, `remerge`, `mergeTreeCheck`), `src/git/worktree.ts` (`addWorktree`, `removeWorktree`, `worktreeWith`, `checkedOutIn`), `src/git/refs.ts` (ref name builders for every ref in data-model.md "Refs", `updateRefs` transaction), `src/git/snapshot.ts` (`snapshot`, `changedSince`), `src/git/remotes.ts` (`pushUrl`, `remoteTip`, `pushWithLease`, `sameRepository` comparing URLs by repository)
- [X] T009 [P] Implement `src/core/runstate.ts`: `RunState` type exactly per data-model.md "RunState" (phases `"rebase" | "merge" | "verify" | "accept" | "report" | "rollback"`), `loadRun`, `saveRun` (atomic tmp plus rename), `clearRun`
- [X] T010 [P] Implement `src/core/patchlist.ts`: types `PatchList`, `Patch`, `Source`, `RetiredPatch`, `AcceptanceCheck`, `HarnessConfig` per data-model.md; `load` (missing file returns null), validation ("A higher version is refused", harness `kind` must be one of the harness registry's `names()` from T011 (not a hard-coded list, SC-006), `fork-branch` has exactly one of `repo` or `url`, `url` must not carry credentials, `rebase` one of `all|conflicting|off`), atomic `save`; unit test `src/core/patchlist.test.ts` (port "a missing config has defaults; a saved one reads back the same", "a config from a newer tool, or with a broken harness, is refused", "harness.kind must be claude or codex" adapted to the five registered kinds; plus a malformed JSON file refused with the file named)
- [X] T011 [P] Write the plugin interfaces from contracts/plugins.md into `src/plugins/sources/types.ts`, `src/plugins/parsers/types.ts`, `src/plugins/harness/types.ts`, each with a `registry.ts` exposing `get(name)` and `names()`
- [X] T012 Implement `src/core/context.ts`: `Context` (io, repo root, data dir, patch list, effective recipe, clock, `progress(line)`, `echo(chunk)`, `signal(event)` that swallows sink exceptions) as in `REF/scripts/custom_build/run.ts` `Context`
- [X] T013 Extend `src/cli/main.ts` with argument parsing and dispatch for every verb and option in contracts/cli.md, `src/cli/usage.ts`, mapping `Explained` to exit 1 and unknown errors to exit 1 with the message; acquire the lock (T006) in dispatch for every verb marked "Lock: yes" in contracts/cli.md and release it in a `finally`; one module per verb under `src/cli/commands/` (stubs for later phases)
- [X] T014 Port the test world from `REF/tests/custom_build.test.ts` (functions `world`, `identity`, `branch`, `pullRequest`, `forkBranch`, `upstreamMoves`, `ownPullRequest`, `stubGh`, `noGh`, `stubHarness`, `takeTheirs`, `fixBroken`, `claudeStream`, `keepArgs`, `interruptHarness`, `run`, `head`, `subjects`, `latest`, `handoffs`, `eventWords`, `backupOf`, `onFork`) into `tests/support/world.ts`, using neutral repository names (`acme/widget` upstream, `me/widget` fork), `DEBASER_GITHUB=file://<root>/github`, a test porting "the test world publishes PR heads and fork branches" in `tests/support/world.test.ts`, and a `configure(w, patches, extra)` helper that writes `patches.json` plus a local override `recipe.toml` with the stub steps (`install: true`, `typecheck: sh -c "! grep -rqs BROKEN --include=*.txt ."`, `test: true`, `build` writing the first-parent merge list to `{output}`), `steps_replace = true`, artifact `output = "out/build"`, `install = "dist/widget-custom"`
- [X] T015 Create `docs/behavior-contract.md` listing every `test(...)` name in `REF/tests/custom_build.test.ts` (141) in a table `| Reference test | Status | debaser test or reason |`, all `pending`; add `tests/contract.test.ts` that parses the table and fails when a `carried` row names a test title that does not exist under `tests/` or `src/` (pending rows allowed until T082)

**Checkpoint**: `bun test` and `bun run typecheck` pass; the binary builds.

---

## Phase 3: User Story 1, rebuild a patched build (P1) 🎯 MVP

**Goal**: `add`/`remove`/`list` and a full `rebuild` of upstream plus patches into an installed artifact, with reports, `-prev`, after-build and `--push`.

**Independent test**: in the test world, add one patch of each source kind, `rebuild`, and check the merge commits, the stub build output, the installed artifact, the report and `result.json`.

### Tests (write first, must fail)

- [X] T016 [P] [US1] Unit tests `src/plugins/sources/parse.test.ts` porting "add arguments name upstream PRs, other repositories' PRs and branches, or own branches" and "sources display as the report names them and slug into file names"
- [X] T017 [P] [US1] Unit tests `src/recipes/resolve.test.ts`: generic detection (`bun.lock` selects `bun-ts`, `Cargo.toml` selects `rust-cargo`, both present stops with the candidates), `recipe` field wins over `extends` wins over detection, step merge by name, `before`/`after` placement, append at end, `steps_replace`, scalar override, `extends` refused outside the lowest non-generic layer, provenance per value, built-in `rtk-ai/rtk` and `tals/corgi` resolve to the step orders in contracts/recipe.md, a TOML syntax error and an unknown key (the mechanism that refuses recipes from a newer debaser) are refused naming the file and key
- [X] T018 [US1] Integration tests `tests/integration/patchlist.test.ts`: first `add` creates `patches.json` from the `upstream` remote, `--upstream owner/repo` overrides, refusal without upstream; "add creates an ignored config, dates entries, refuses duplicates and takes PR titles" (adapted: file lives in the data dir); "remove retires a patch with its reason, which it needs off a terminal"; "--dir and DEBASER_DIR move every read and write, the option winning"; "a fork URL with credentials is refused, on add and in the config"; "add refuses the custom branch and its backup as patches"; `--pin <sha>` stored and shown in `list`
- [X] T019 [US1] Integration tests `tests/integration/rebuild.test.ts` porting: "rebuild merges an own branch, an upstream PR, a fork PR and a fork branch in order"; "rebuild refuses a dirty checkout or a stopped run and changes nothing" (dirty = tracked changes only, an untracked file is allowed); "a patch that can't be fetched stops the run before anything is reset"; "merged and contained patches are skipped, closed PRs merged with a warning"; "a PR merged on another repository is still merged; one merged upstream is skipped"; "the after-build command runs only after a successful run"; "a successful run keeps the previous build as -prev" (branch `debaser-prev` and `dist/widget-custom.prev`); "rollback with nothing built says so"; "rebuild --push sends the custom branch to origin; a plain rebuild never pushes"; "rebuild refuses a patch named like a branch it resets, and --push to upstream under another name"; "a custom branch checked out in another worktree is refused before anything changes"; "reports/latest follows the newest run and only ten runs and ten rollback logs are kept"; "an own branch behind its pushed copy uses the pushed one; a diverged one uses local with a warning"; "an own branch known only from a stale origin copy stops instead of building the old commit"; plus new: `rebuild`, `continue` and `rollback` refuse while another command holds the lock, the lock is released when a command throws, a rebuild with zero live patches builds plain upstream, `DEBASER_PATCHES`/`DEBASER_FORK_URL`/`DEBASER_COMMIT`/`DEBASER_MANIFEST` visible to a step, `--json` prints `result.json`, a pinned patch merges exactly its pinned commit, no matching recipe exits 1 listing `bun-ts` and `rust-cargo`

### Implementation

- [X] T020 [P] [US1] Port `REF/scripts/custom_build/sources.ts` into `src/plugins/sources/{parse,branch,pr,fork-branch}.ts` implementing `SourceKind` (contracts/plugins.md), GitHub base from `DEBASER_GITHUB` else `https://github.com`, private refs under `refs/debaser/`
- [X] T021 [P] [US1] Port `REF/scripts/custom_build/github.ts` into `src/github/gh.ts` (`prInfo` via `gh pr view --json state,title,body,mergeCommit,headRepositoryOwner,headRepository,headRefName,url`, null when `gh` is missing or fails)
- [X] T022 [P] [US1] Implement `src/recipes/schema.ts` validating recipe TOML per data-model.md "Recipe" (unknown keys rejected with the file and key named)
- [X] T023 [P] [US1] Write `src/recipes/builtin/bun-ts.toml`, `rust-cargo.toml`, `tals-corgi.toml`, `rtk-ai-rtk.toml` with the contents of research.md R11 and contracts/recipe.md, and `src/recipes/builtin/index.ts` embedding them with `with { type: "text" }` keyed by name and by `owner/repo`
- [X] T024 [US1] Implement `src/recipes/resolve.ts` for layers 1 (generic), 2 (built-in project) and 4 (local `<dir>/recipe.toml`) with the merge rules of FR-039 to FR-039b and per-value provenance; layer 3 is added in T073
- [X] T025 [US1] Implement `src/cli/commands/add.ts`, `remove.ts`, `list.ts` and `src/views/list.ts` (port `REF/scripts/custom_build/list_view.ts`), including patch list bootstrap (FR-001a), PR titles via `gh`, `--pin`, retire with reason (asked on a terminal, required off one)
- [X] T026 [P] [US1] Implement `src/steps/commands.ts` (placeholders `{output}`, `{tests}`, `{root}`; `{tests}` as a whole argument expands to one argument per file and to nothing on a full run) and `src/steps/install.ts` (install needed when the recipe's `install.marker` is missing or `git diff --quiet <startHead> HEAD -- <triggers>` reports a change); unit tests beside them, porting "install runs when nothing is installed yet, even with unchanged manifests"
- [X] T027 [US1] Implement `src/steps/run.ts` `runStep(ctx, step, tree, logPath)`: spawn with step timeout (timeout counts as failure), log to `steps/<step>.log`, echo output through `ctx.echo`, set `DEBASER_PATCHES`, `DEBASER_FORK_URL`, `DEBASER_COMMIT`, `DEBASER_MANIFEST`
- [X] T028 [US1] Implement `src/run/fetch.ts` porting `fetchRemote`/`fetchPatch` from `REF/scripts/custom_build/run.ts`: fetch upstream and all patches before any reset, pinned patches at their commit, skip `merged` (PR merge commit or head is an ancestor of upstream) and `contained`, `closed-warning` for closed PRs, own branch local vs pushed copy (behind uses pushed, diverged uses local with a warning, stale-only stops with exit 1)
- [X] T029 [US1] Implement `src/run/mergeloop.ts`: reset `git checkout -B <branch> <upstream>` (a failed reset discards `run.json`), merge each planned patch with `Merge <display>: <description>`, rerere replay recorded as `by: "rerere"`, unresolved conflict without harness stops with exit 2 listing the files
- [X] T030 [US1] Implement `src/run/verifyloop.ts` (first version): run install (when needed) and every recipe step in order; a failure stops with exit 3 (flaky and upstream blame come in T038 to T040)
- [X] T031 [US1] Implement `src/report/manifest.ts` (write `manifest.json` per data-model.md "BuildManifest" before the first step) and `src/report/report.ts` (`report.md`, `result.json` per data-model.md "Report", `latest` relative symlink, prune keeping 10 run and 10 `rollback-*` directories; port `REF/scripts/custom_build/report.ts`)
- [X] T032 [US1] Implement `src/run/finish.ts`: copy the build output to the recipe's install path only after a fully successful run, the replaced copy to `<install>.prev` (copy to tmp then rename, keeping a running binary's inode), `branch -f <branch>-prev <startTip>`, run `after_build` (failure warns, log `steps/after-build.log`), `--push` with `git push --force-with-lease origin <branch>:<branch>` and refusal when origin is upstream
- [X] T033 [US1] Implement `src/run/rebuild.ts` and `src/cli/commands/rebuild.ts`: lock, preflight (git 2.38, no `run.json`, clean tracked tree, branch valid and not upstream's, not checked out in another worktree, no patch named like the branch or `-prev`), resolve recipe, save start artifact to `work/artifact.start`, phases fetch, merge, verify, finish, report; `--json` prints `result.json`
- [X] T034 [US1] Implement the no-run path of `src/run/rollback.ts` and `src/cli/commands/rollback.ts`: `checkout -B <branch> <branch>-prev`, restore `<install>.prev`, rerun the install step (log `reports/rollback-<stamp>/steps/install.log`), refuse with "nothing to roll back" when neither a stopped run nor a previous build exists

**Checkpoint**: T016 to T019 pass. MVP slice 1 works end to end in plain output.

---

## Phase 4: User Story 2, stop, blame and recover (P1) 🎯 MVP

**Goal**: flaky reruns, plain-upstream blame, stops with prompts, `continue`, `rollback` of stopped runs, signal handling.

**Independent test**: conflicting and check-breaking patches without a harness: exit codes 2, 3, 4, then `continue` and `rollback`.

### Tests

- [X] T035 [P] [US2] Unit tests `src/plugins/parsers/bun-test.test.ts`, `tsc.test.ts`, `generic.test.ts` with fixture logs (port the `testFailures`/`failureSummary` cases in `REF/scripts/custom_build/steps.test.ts`, and "a failure log names a file only outside lines that hold nothing but a path")
- [X] T036 [P] [US2] Unit test `src/plugins/parsers/cargo-test.test.ts` with fixture `cargo test` output: failed test names from `---- <name> stdout ----`, files from `panicked at <file>:<line>` and `--> <file>:<line>`, summary line, no `narrowedArgs`
- [X] T037 [US2] Integration tests `tests/integration/stops.test.ts` porting: "a conflict without a harness stops with the files, then continue finishes and rerere replays it"; "a step failing only on the custom branch stops with 3; failing on upstream too stops with 4"; "a step that fails once and passes when run again is reported as flaky, never fixed or blamed"; "a stopped run is recorded once, when it finishes"; "a stopped run leaves the backups alone"; "rolling back a stopped first run returns to the branch it started on"; "a run that is stopped refuses another with where it stopped and what to run"; "continue after an interrupted step commits only tracked changes"; "continue refuses when the custom branch is no longer checked out"; "a reset that fails forgets the run and changes nothing"; "rollback of a stopped run keeps uncommitted edits on another branch"; "a rollback refused for uncommitted changes leaves the stopped run to continue"; "rollback reinstalls dependencies, and continue finishes a rollback whose install failed"; "rollback to the previous build reinstalls dependencies"; "a step stop names the patches behind it and writes a prompt for fixing it with an agent"; plus new: a step exceeding a 1 s timeout counts as failing (rerun, then upstream rerun); a stub step that sends SIGINT to debaser's process ends with exit 130, keeps `run.json` in its phase, releases the lock, and `continue` and `rollback` work afterwards

### Implementation

- [X] T038 [P] [US2] Implement `src/plugins/parsers/bun-test.ts`, `tsc.ts`, `generic.ts` (port `testFailures`, `failureSummary`, `failureText` from `REF/scripts/custom_build/steps.ts`) and `cargo-test.ts` (research R7); register all four
- [X] T039 [US2] Implement `runWithRetry` in `src/steps/run.ts`: keep the first failure log as `steps/<step>-flaky-N.log`, rerun once (narrowed with the parser's `narrowedArgs` for `{tests}`), record a `flaky` event when the rerun passes
- [X] T040 [US2] Implement `src/steps/isolated.ts` (`runIsolated(ctx, name, base, refs, step)`: detached worktree `work/isolated-<name>`, merge refs, install then step, log `isolated/<name>-<step>.log`, always remove the worktree, return `"conflict"` on merge conflict) and use it in `src/run/verifyloop.ts` so a second failure reruns the step on plain upstream: failing there records `upstream-broken` and stops with exit 4 blaming nobody, else exit 3
- [X] T041 [US2] Implement `src/run/stop.ts`: `stopped = {code, snapshot}`, `stopFailure` via blame (cached per step and HEAD, log copied to `steps/<step>-failed-N.log`), report written, `fix-<step>.md` agent prompt from `src/prompts/check.md`, and stop lines naming the step or files, implicated patches, the log, and the `debaser continue` / `debaser rollback` commands (no self-copy fallback)
- [X] T042 [US2] Implement `src/run/resume.ts` and `src/cli/commands/continue.ts` for rebuild runs: merge phase commits the user's resolution (`by: "user"`) or accepts a merge the user committed (`HEAD^2` equals the patch commit); verify phase commits tracked changes since the stop snapshot as `debaser: fix <step> (user)` and counts commits since `stopFailure.head`; refuse when the integration branch is not checked out or does not contain upstream; a run in phase `rollback` is finished by rollback
- [X] T043 [US2] Complete `src/run/rollback.ts` for stopped runs: `merge --abort`, forced `checkout -B <branch> <startTip>` (or `startBranch` and delete the integration branch for a first run), restore `work/artifact.start`, reinstall (log `steps/rollback-install.log`), clear the run; refuse on uncommitted changes leaving the run continuable; keep edits on other branches
- [X] T044 [US2] Signal handling in `src/cli/main.ts` and `src/git/git.ts`: SIGINT, SIGTERM, SIGHUP end with 130, 143, 129, keep `run.json` in its phase, release the lock

**Checkpoint**: T035 to T037 pass. MVP complete (US1 and US2).

---

## Phase 5: User Story 3, verified agent repair and handoffs (P2)

**Goal**: harness adapters, verified conflict resolutions and fixes, attempts and bounds, per-task harness, attribution, handoffs.

**Independent test**: stub harness scripts that resolve, mis-resolve, fix, break or hang; check commits, trailers, retries, exit 5 and handoff files.

### Tests

- [X] T045 [P] [US3] Unit tests `src/plugins/harness/*.test.ts` per adapter with fixture streams: claude and codex (port `REF/scripts/custom_build/harness_stream.test.ts`), pi (`message_end` text, `tool_execution_start` activity, usage summed over assistant `message_end` only, `stopReason: "error"` reported by `failed()`), opencode (`text`, `tool_use`, `step_finish` tokens with cache and reasoning, `error` event), plain (lines pass through, usage null); `args()` adds only the flags in research.md R6
- [X] T046 [US3] Integration tests `tests/integration/harness.test.ts` porting: "a harness resolution that passes the checks is committed with a trailer"; "harness resolutions with markers, extra edits, commits or timeouts are rejected until attempts run out"; "a harness that can't be run is a warning, and the run stops as without one"; "a harness build fix becomes its own commit and the steps rerun; the next rebuild drops it"; "a harness that changes nothing exhausts its attempts; upstream breakage never calls it"; "a claude harness logs readable text, keeps the raw stream and records tokens"; "plain run with kind claude shows readable text"; "a harness without kind is run and logged as today"; "rejected fixes and rebase conflicts are recorded as harness calls"; "a harness that fails to start is asked once, and the stop says why"; "after a harness fix every step runs again, so a fix can't break a step that passed"; "a second fix for the same step is recorded against the failure it answered"; "a fix for every step within one attempt each still finishes the run"; "a recorded resolution replays before any harness is called"; "a harness retry keeps the files rerere replayed staged, so a later attempt can pass"; "the conflict prompt for a PR carries its link and description"; "a harness that times out takes its children with it"; "a fix never commits the temporary files an interrupted bun build leaves" (generalized: files matching the recipe's ignored build leftovers); "continue after an interrupted harness conflict call commits leftovers that pass the checks as the agent's"; "continue after an interrupted harness conflict call rejects leftovers that fail the checks"; "continue after an interrupted harness build call commits an accepted fix as the agent's and hands it off"; "continue after an interrupted harness build call that changed nothing stops without committing"; plus new: per-task harness selection (FR-023), fix bound `attempts × (steps + acceptance checks)` ends with exit 5
- [X] T047 [US3] Integration tests `tests/integration/handoffs.test.ts` porting: "a patch that conflicts with upstream is reported for a rebase with a handoff"; "patches that only clash with each other get a note and no handoff, however resolved"; "an agent fix for a patch that fails alone on upstream hands off build drift to that patch"; "an agent fix for patches that only fail together hands off a clash naming each other"; "an agent fix touching a single patch that passes alone names the other merged patches as its clash"; "an agent fix that no patch is named for runs nothing to attribute it and hands off nothing"; "attribution says which patch it runs alone and how many are left"; "a stopped and continued run keeps one set of handoffs"

### Implementation

- [X] T048 [P] [US3] Implement `src/plugins/harness/claude.ts` and `codex.ts` (port `REF/scripts/custom_build/harness_stream.ts`)
- [X] T049 [P] [US3] Implement `src/plugins/harness/pi.ts`, `opencode.ts`, `plain.ts` per research.md R6, splitting input on `\n` only
- [X] T050 [US3] Implement `src/harness/invoke.ts` (port `invoke` from `REF/scripts/custom_build/harness.ts`): prompt file `prompts/NN-<task>.md`, `{prompt_file}` substitution, env `DEBASER_TASK` and `DEBASER_PROMPT`, stdin closed, `detached: true`, timeout kills `-pid` with SIGKILL, group also killed after exit and on signals, readable `.log` starting with `$ <cmd>` and ending `(exit N)` or `(killed after Ns)`, raw `.jsonl` for non-plain kinds, usage recorded in `harnessUsage`; a non-executable command returns a "not executable" result
- [X] T051 [US3] Implement `src/harness/verify.ts` (`acceptConflict`, `acceptFix`, `discard`, `judge`) per contracts/plugins.md and the rules in `REF/scripts/custom_build/harness.ts`; `broken` when the process exited non-zero or the adapter's `failed()` reports a reason
- [X] T052 [US3] Port the prompt templates from `REF/scripts/custom_build/prompts/` into `src/prompts/{conflict,check,acceptance,rebase-conflict,rebase-check,handoff}.md` with the project name placeholder and no corgi or "upstream main" wording; implement `src/harness/prompts.ts` (`{{var}}` fill, lists as `- item` lines, empty as `none`; an `overrides` parameter that T073 feeds from recipe `[prompts]`)
- [X] T053 [US3] Wire the harness into `src/run/mergeloop.ts`: rerere first, then the conflict harness up to `attempts`, rejected attempts discarded with `remerge` keeping rerere-staged files, accepted merge committed with trailer `Resolved-By: harness`, harness not executable falls back to the no-harness stop with a warning, broken or exhausted ends with exit 5 naming the harness exit code and last output line
- [X] T054 [US3] Wire the harness into `src/run/verifyloop.ts`: call only when the step passes on plain upstream, fix committed as `debaser: fix <step> (agent)` with `Fixed-By: harness`, restart from the first step, fix bound (FR-021) ends with exit 5, fixes never carried into the next rebuild
- [X] T055 [US3] Implement per-task harness resolution (`conflict`, `check`, `acceptance`, `rebase` falling back to the top-level harness) in `src/harness/select.ts`
- [X] T056 [US3] Implement `src/steps/attribute.ts` (FR-027: candidates from parser `implicatedPaths` or the generic scan matched against each merged patch's `git diff --name-only <merge>^1 <merge>`, each candidate run alone with `runIsolated` named `attribute-<sha7>`, progress "running <patch> alone, N left") and `src/report/handoff.ts` (kinds `rebase`, `build-drift`, `build-clash` note, `acceptance`, `rebase-checks`; one file per patch under `handoffs/`, rewritten per report)
- [X] T057 [US3] Extend `src/run/resume.ts` to judge what an interrupted harness call left (`harnessCall` in `run.json`) before continuing: accepted leftovers committed as the agent's, rejected ones stop
- [X] T058 [P] [US3] Write `docs/harness.md`: one safe example command per agent (claude with `--allowedTools`, codex `exec` with a sandbox flag, pi with `--tools`, opencode with `--auto` and an agent definition), noting that debaser adds only streaming flags (FR-025)

**Checkpoint**: T045 to T047 pass.

---

## Phase 6: User Story 4, per-patch acceptance checks (P2)

**Goal**: acceptance checks after the build, blame per patch, harness fix, exit 6, unverified.

**Independent test**: three patches (passing check, failing check, none); check the per-patch results, blame and exit codes.

- [X] T059 [US4] Integration tests `tests/integration/acceptance.test.ts`: pass and fail by exit code; `match` regex searched in combined stdout and stderr; `DEBASER_ARTIFACT` points at the build output and the check runs from the tree root; default timeout 300 s overridable (use a 1 s timeout in the test); all checks run before reporting; failure without harness exits 6 with an `acceptance` handoff for that patch only and the previous installed artifact untouched; flaky check reported as flaky; harness fix scoped to the patch reruns every step, rebuilds and reruns checks; harness out of attempts exits 5; patch without a check listed as `unverified` and the run succeeds; acceptance fixes count toward the fix bound; an invalid `match` regex is refused when the patch list loads, naming the patch; a patch skipped as merged or contained does not run its check and is reported as `skipped`
- [X] T060 [US4] Implement `src/run/accept.ts` (`runAcceptance` per contracts/plugins.md, env with `DEBASER_ARTIFACT` unset when the recipe has no artifact, logs `acceptance/<patch-slug>.log`, one flaky rerun) and the `accept` phase in `src/run/rebuild.ts` between verify and finish
- [X] T061 [US4] Add the acceptance harness task in `src/run/accept.ts` (prompt `src/prompts/acceptance.md`, commit `debaser: fix acceptance <patch> (agent)` with `Fixed-By: harness`, then back to the verify phase from the first step), exit 6 stop with `stopFailure` pointing at the acceptance check, and `acceptance` results in `result.json`, `report.md` and `run.json`

**Checkpoint**: T059 passes.

---

## Phase 7: User Story 5, keep own branches rebased (P2)

**Goal**: own-branch rebasing in throwaway worktrees with checks, fixes, backups, lease pushes, pending pushes, in-worktree mode and the `rebase` command.

**Independent test**: own branches behind upstream (clean, conflicting, failing alone) plus someone else's PR; run `rebase` and `rebuild`; check moved branches, backups, handoffs and lease pushes.

- [X] T062 [US5] Integration tests `tests/integration/rebase.test.ts` porting every reference test from "rebuild rebases own branches behind upstream, conflicting or not, and merges the rebased tips" through "a pending push stays offered while its branch is checked out" (the block starting at `REF/tests/custom_build.test.ts` line 2109, excluding the tests assigned to T018, T069 and T076), adapted to `refs/debaser/` names; plus new: a pinned own branch is never rebased
- [X] T063 [US5] Implement `src/rebase/select.ts` (port `select`, `forkProblem` from `REF/scripts/custom_build/rebase.ts`): candidates are own patches per FR-032 excluding pinned ones, refuse without origin or when origin is upstream, lease via `ls-remote` on the push URL, fork copy fetched to `refs/debaser/fork/<b>`, skip diverged, checked out elsewhere (unless `--in-worktree`), already upstream, and in `conflicting` mode clean ones
- [X] T064 [US5] Implement `src/rebase/rebase.ts` worktree rebase (port `rebaseTarget`, `rebaseKeepingTodo` with a sequence-editor script under `work/`, pinned rebase configs, `GIT_EDITOR=true`, rerere on): conflicts go to the rebase harness one commit at a time (FR-035a), rejected resolutions retried from that commit keeping git's choice of commits
- [X] T065 [US5] Implement rebased-branch checks in `src/rebase/rebase.ts`: install plus every recipe step on the rebased tip in its worktree (logs `rebase/<slug>-<step>.log`), flaky rerun, failures go to the rebase harness as `fix: pass <step> on upstream <sha7>` commits with `Fixed-By: harness` (FR-031a), no harness or exhausted keeps the old tip with a `rebase-checks` handoff
- [X] T066 [US5] Implement the atomic branch move (backup, rebased, lease refs and `refs/heads/<b>` in one `updateRefs`, skip a branch moved during the run) and `src/rebase/push.ts` (reusing `pushWithLease` from `src/git/remotes.ts`; this module holds only pending detection, offer again later, refused push writes `rebase/<slug>-push.log` and makes the run exit 1)
- [X] T067 [US5] Implement `--in-worktree` (rebase in the user's clean worktree with a backup first, `refs/debaser/rebase-checking/<b>` marker, restore on failed checks while keeping commits and edits made during the checks, skip a worktree that switched branches)
- [X] T068 [US5] Wire the rebase phase into `src/run/rebuild.ts` (`stopOnConflict: false`, rebased tips replace planned commits, a branch named by two patches rebased once) and implement `src/cli/commands/rebase.ts` plus rebase-run handling in `resume.ts` (`continue`, `continue --skip-branch`) and `rollback.ts` (`undoInterrupted`, `abandon`, `cleanLeftovers`), with the push question on a terminal and `--push`

**Checkpoint**: T062 passes.

---

## Phase 8: User Story 6, status at a glance (P3)

- [X] T069 [US6] Integration tests `tests/integration/status.test.ts` porting "status reads origin from git's own ref, so a branch force-pushed by hand isn't diverged", "status checks an own PR's rebased branch against upstream, not the PR as last fetched", "status lists own branches behind, conflicting with or left alone by upstream"; plus new: PR state per patch, merge check against the last fetched upstream, last check and acceptance results from the latest `result.json`, upstream commits since the last build, pinned patches marked as pinned, no `git fetch` without `--fetch`, works while a run lock is held, `--json` output, refs and working tree unchanged afterwards
- [X] T070 [US6] Implement `src/views/status.ts` (port `REF/scripts/custom_build/status_view.ts`) and `src/cli/commands/status.ts` (port `status` from `REF/scripts/custom_build/run.ts`, `mergeTreeCheck` per patch, `--fetch`, `--json`)

---

## Phase 9: User Story 7, recipes projects can share and extend (P3)

- [X] T071 [US7] Integration tests `tests/integration/recipes.test.ts`: `.debaser/recipe.toml` is read from the fetched upstream tip and a patch changing it has no effect; first use on a terminal shows the commands and asks; headless refuses with exit 1 unless `--trust-recipe`; changed content asks again; trusted repo recipe wins over the built-in project recipe; local override wins over all; a local `[prompts].conflict` override reaches the written prompt file; `debaser recipe` prints every value with its layer; `debaser trust` records the fingerprint in `trust.json`
- [X] T072 [US7] Implement `src/recipes/trust.ts` (`trust.json` per data-model.md, SHA-256 of content) and `src/cli/commands/trust.ts`
- [X] T073 [US7] Add layer 3 to `src/recipes/resolve.ts` (`git show <upstream-tip>:.debaser/recipe.toml`, trust check, `--trust-recipe`) and prompt overrides from recipe `[prompts]` (paths relative to the recipe's layer)
- [X] T074 [US7] Implement `src/views/recipe.ts` and `src/cli/commands/recipe.ts` (text and `--json`, value plus layer such as `generic:bun-ts`, `project:rtk-ai/rtk`, `repo:.debaser/recipe.toml@<sha7>`, `local`)

---

## Phase 10: User Story 8, live view, timings and headless runs (P3)

- [X] T075 [P] [US8] Port the unit tests `REF/scripts/custom_build/{live_state,live_render,screen,term,timings,task_view}.test.ts` and `live.test.ts` into `src/live/*.test.ts` and `src/timings/timings.test.ts`, adding the `accept` stage
- [X] T076 [US8] Integration tests `tests/integration/live.test.ts` porting: "a rebuild records its timings and the next one has history"; "a run state without timing loads"; "rollback on a terminal shows its steps and ends in a card"; "an error before the run began ends the live view in a card"; "a rebuild signals stages, items and the end"; "a rebuild prints the same with and without a sink"; "a stopped run signals the stop, and continue replays it first"; "a rebase run signals its branches"; "a rebuild's rebase phase signals its branches and harness calls"; "rebuild --verbose is accepted and plain output is unchanged"; "a live rebuild prints a summary card that points at the report"; "a live command that throws ends its view with the error"; "a timings history that can't be written is a warning, and the run keeps its outcome"; "the usage names --verbose for every command with a live view"; "a live run shows its warnings on the card"; "a live run pauses for the push question"; "step names link to their logs, in a run and in its continue"; "continue shows the earlier progress"; "a continue that stops again before going on ends its item as stopped"; "a rebase run records its timings, without the wait for the push answer"; "a claude harness's activity reaches the sink, and a sink that throws on it stops nothing"
- [X] T077 [P] [US8] Port `live_events.ts` and `live_state.ts` into `src/live/events.ts` and `src/live/state.ts` (pure reducer, `fromRun` replay, `accept` stage)
- [X] T078 [P] [US8] Port `live_render.ts`, `screen.ts`, `term.ts` into `src/live/render.ts`, `screen.ts`, `term.ts` (titles say `debaser`)
- [X] T079 [US8] Port `live_worker.ts`, `live.ts`, `task_view.ts` into `src/live/worker.ts`, `live.ts`, `task-view.ts` (worker URL `new URL("./worker.ts", import.meta.url)` so the compiled binary finds it, `inline` mode for tests, fallback plain output when the card is not confirmed within 3 s)
- [X] T080 [US8] Port `timings.ts` into `src/timings/timings.ts` and record timings in rebuild, rebase and continue (prompt waits excluded, write failure only warns)
- [X] T081 [US8] Emit live events from every phase in `src/run/*.ts` and `src/rebase/*.ts`, route `progress`/`echo` into `log` events in live mode, and choose the live view in `src/cli/main.ts` (`isTTY`, `NO_COLOR`, `TERM`), with `--verbose` pinning the view

---

## Phase 11: Polish & cross-cutting

- [X] T082 Complete `docs/behavior-contract.md`: every reference test `carried` (with the debaser test title) or `dropped` with a reason (for example the self-copy tests, the `.gitignore` exclude test, the real-steps test replaced by recipe tests); make `tests/contract.test.ts` fail on any `pending` row
- [X] T083 [P] Add `tests/independence.test.ts` failing when `src/` mentions `corgi`, `custom-build` or `custom_build` (case-insensitive) outside `src/recipes/builtin/tals-corgi.toml` (SC-004)
- [X] T084 [P] Add `tests/smoke/binary.test.ts`: builds `dist/debaser` once, runs `--version`, `add`, `rebuild` and `status --json` against a test world through the binary, checks the live worker starts from the binary under a pseudo terminal (`script -q /dev/null` on macOS, `script -qc` on Linux), and asserts warm `--version` startup under 100 ms (best of 3)
- [X] T085 [P] Write `README.md`: what debaser does, install (release binary, `bun run build`), patch list and sources, recipes and layers, acceptance checks, harness setup (link `docs/harness.md`), commands and exit codes (from contracts/cli.md), data directory
- [X] T086 Run quickstart.md sections 1 and 2 and fix anything that fails; write `docs/pilots.md` with the post-merge manual validation for SC-002 (rtk and corgi pilot rebuilds, quickstart section 8), SC-003 (`time debaser status` on the rtk pilot, under 10 s) and SC-008 (record a two-week baseline with the old tool, then count runs with `outcome == "stopped"` in `result.json` over a month)

---

## Dependencies & Execution Order

- Setup (T001 to T003), then Foundational (T004 to T015) block everything.
- US1 (Phase 3) blocks every later story: it creates the run driver.
- US2 (Phase 4) depends on US1; together they are the MVP.
- US3 depends on US2 (stops, resume). US4 depends on US3 for harness fixes but its non-harness part (T060) only needs US2.
- US5 depends on US3 (rebase harness) and US2.
- US6 depends on US1 (and shows US4/US5 data when present). US7 depends on US1. US8 depends on US1 to US5 for the events it shows.
- Polish runs last.

```text
Setup -> Foundational -> US1 -> US2 -> US3 -> US4
                                   \      \-> US5
                                    \-> US6, US7 (any time after US1)
                                         US8 after US5
```

## Parallel Opportunities

- Foundational: T005, T006, T008, T009, T010, T011 together after T004 and T007.
- US1: T016, T017 together; T020, T021, T022, T023, T026 together.
- US2: T035, T036 together; T038 alongside T039.
- US3: T045 with T048 and T049; T058 any time.
- US8: T075, T077, T078 together.
- Polish: T083, T084, T085 together.

## Implementation Strategy

1. **MVP**: Phases 1 to 4 (US1, US2). Stop and validate: rebuild, stops, continue, rollback in plain output against the test world.
2. Add US3 (agent repair), then US4 (acceptance) and US5 (rebasing): each is a release-worthy increment.
3. Add US6, US7, US8, then polish and the behavior contract.
