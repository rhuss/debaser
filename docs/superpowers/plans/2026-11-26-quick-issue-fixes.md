# Quick Issue Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issues #1, #3, #4, #5, #6, #7 and #8 in one PR, one commit per issue.

**Architecture:** Each task is one issue and one commit on `fix/quick-issues`. Code fixes are test-first against the existing in-process test world (`tests/support/world.ts`); docs and spec edits follow the issue's proposal wording.

**Tech Stack:** TypeScript on Bun 1.4.4, `bun test`, `bun run typecheck`.

**Spec:** `docs/superpowers/specs/2026-11-26-quick-issue-fixes-design.md`. Read each issue (`gh issue view N`) before its task: the issue lists exact lines and proposed wording.

## Global Constraints

- Branch `fix/quick-issues` (from `origin/main`); one commit per issue, message `<type>(<area>): <summary>` plus `Fixes #N` and the trailer `Assisted-By: 🤖 Claude Code`.
- No em-dash or en-dash characters in any text written (docs, messages, comments).
- No behavior change beyond what the issue asks for.
- Run single tests with `bun test <file> -t "<name>"`; before each commit `bun run typecheck` passes.

## Review Focus

- A branch that really diverged (origin moved after debaser's rebase) must keep the `warning:` note (#3). Pinned by the existing build test at `tests/integration/build.test.ts:279`, which must stay green.
- `after_build = []` must not show an `after-build` stage in the live view or call `runStep` with an empty command (#1). Every `afterBuild` truthiness check (`src/run/finish.ts:62`, `src/run/live.ts:106,112`, `src/views/recipe.ts:48`) uses `.length`. Test in Task 6.
- `recipe --trust-recipe` must fail as a usage error (exit 1, usage text), not as a crash (#6). Test in Task 2.
- A PR patch with `gh` answering normally still shows its real state, and branches still show `not a PR` (#8). Existing status tests at `tests/integration/status.test.ts:94-158` must stay green.
- `result.json` for a real PR keeps `pr: {state, url}` (#8). Pinned in Task 4's test.

---

### Task 1: #7 comments and the step-placement message

**Files:**
- Modify: `src/run/build.ts:57-60`, `src/git/refs.ts:3`, `src/recipes/resolve.ts:60`
- Test: `src/recipes/resolve.test.ts:60-62`

- [ ] **Step 1:** Change the expectation in `resolve.test.ts:61` to `"step q is placed before missing, which is not among the steps so far"`.
- [ ] **Step 2:** Run `bun test src/recipes/resolve.test.ts`. Expected: FAIL on that message.
- [ ] **Step 3:** In `resolve.ts:60` change the message tail from `which no lower layer has` to `which is not among the steps so far`.
- [ ] **Step 4:** Rewrite the `build.ts` comment: the build directory is checked and created when missing after the preflight refusals, before the upstream fetch and the recipe trust check, which can still refuse and leave the new directory behind. Rewrite the `refs.ts:3` comment: refs debaser fetches and its bookkeeping live under `refs/debaser/`; the integration branch and its `-prev` backup are ordinary branches under `refs/heads/`.
- [ ] **Step 5:** Run `bun test src/recipes/resolve.test.ts` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `fix(recipes): say where a step anchor is looked up; correct two comments` with `Fixes #7`.

### Task 2: #6 usage text and hints

**Files:**
- Modify: `src/cli/usage.ts`, `src/cli/commands/index.ts:84`, `src/cli/commands/recipe.ts:16`, `src/cli/commands/add.ts:36-38`, `src/recipes/trust.ts:73,104-106`, `src/recipes/load.ts:12`, `src/run/rollback.ts:79,145`
- Test: `tests/integration/recipes.test.ts`, `tests/integration/patchlist.test.ts` (add hint)

**Interfaces:**
- Produces: `loadRecipe(ctx, tip?, o: { peek?: boolean; trustFlag?: boolean } = {})` and `repoLayer(ctx, tip, o: { peek?: boolean; trustFlag?: boolean })`. `trustFlag` defaults to `true`; `false` drops `, or pass --trust-recipe` from the headless refusal hint.

- [ ] **Step 1: Tests.** In `recipes.test.ts`:
  - `"debaser recipe refuses --trust-recipe as a usage error"`: `run(w, "recipe", "--trust-recipe")` gives `code` 1 and `err` containing `usage: debaser`.
  - `"a headless rollback with an untrusted project recipe offers only debaser trust"`: `upstreamRecipe(w, "first", file)`, `withoutLocal(w, ["mine"])` with `branch(w, "mine", {...})`, two `build --trust-recipe` runs (so a previous build exists), delete `join(dirOf(w), "trust.json")`, then `run(w, "rollback")`: `code` 1, `err` contains ``run `debaser trust` `` and does not contain `--trust-recipe`.
  - Find the existing test that hits the no-upstream-remote refusal of `add` (`rg "no upstream remote" tests`) and add: `err` contains `upstream commits are then fetched from origin`.
- [ ] **Step 2:** Run those tests. Expected: FAIL (the first exits 0, the second names `--trust-recipe`, the third lacks the sentence).
- [ ] **Step 3: Implement.**
  - Verb table: `recipe: { parse: reader(["json"], 0), ... }`; remove the `ctx.trustRecipe = false;` line in `recipe.ts`.
  - `trust.ts`: the hint reads ``"  review it, then run `debaser trust`" + (o.trustFlag === false ? "" : ", or pass --trust-recipe")``; `load.ts` passes `trustFlag` through; `rollback.ts` calls `loadRecipe(ctx, tip, { trustFlag: false })` at both lines.
  - `add.ts`: after the `or name it` line add `"    (with --upstream and no upstream remote, upstream commits are then fetched from origin; when origin is a fork, add the upstream remote instead)"`.
  - `usage.ts`: `add <source> [description] [--description <text>] [--pin <sha>] [--upstream owner/repo]`; `list [--verbose] [--retired] [--json]` with help `--verbose or --retired adds the retired ones`; `[--trust-recipe]` on the `rebase` line and on `continue [--skip-branch] [--trust-recipe] [--verbose]`.
- [ ] **Step 4:** Run the three tests plus `tests/smoke/binary.test.ts` and `tests/integration/recipes.test.ts`. Expected: PASS (existing build hint tests still expect `or pass --trust-recipe`).
- [ ] **Step 5:** Commit `fix(cli): match usage text and hints to what the parser accepts` with `Fixes #6`.

### Task 3: #5 spec drift and `recipe --json` paths

**Files:**
- Modify: `src/cli/commands/recipe.ts`, `specs/001-standalone-patch-build-tool/spec.md` (lines 233-234, 301, 325 and the user stories using `rebuild`)
- Test: `tests/integration/config.test.ts` (the test around line 55-73)

- [ ] **Step 1:** In the config test, after the `layerSources` assertion add `expect(json.config).toEqual(JSON.parse((await run(w, "list", "--json")).out).config)`.
- [ ] **Step 2:** Run it. Expected: FAIL (`json.config` undefined).
- [ ] **Step 3:** In `recipe.ts` add `config: configInfo(ctx)` (from `../../core/tree`) as the first field of `json`.
- [ ] **Step 4:** Run the config test. Expected: PASS.
- [ ] **Step 5:** Spec 001: add a supersede note at FR-054 that the verb `rebuild` was renamed to `build` (the user stories keep the old word; the note says so once); FR-039a reads `steps_replace = true`; mark FR-008a and FR-009 SUPERSEDED by spec 002 in the same form as the other superseded requirements in that file (`rg -n SUPERSEDED specs/001-standalone-patch-build-tool/spec.md`).
- [ ] **Step 6:** Commit `fix(recipe): add config paths to recipe --json; mark replaced spec requirements` with `Fixes #5`.

### Task 4: #8 status, report.md and result.json

**Files:**
- Modify: `src/cli/commands/status.ts:115`, `src/views/status.ts:130`, `src/report/report.ts:147,250`, `specs/001-standalone-patch-build-tool/data-model.md:162`
- Test: `tests/integration/status.test.ts`, `tests/integration/build.test.ts`

- [ ] **Step 1: Tests.**
  - `status.test.ts` `"status shows unknown for a PR whose state gh can't give"`: `pullRequest(w, "acme/widget", 1, {...})`, `noGh(w)`, `configure(w, ["#1", "mine"])` with a branch `mine`, `run(w, "status")`: row for `acme/widget#1` matches `/ unknown /`, row for `mine` still `not a PR`.
  - `build.test.ts`, extend the failed-push test (line 398): `read(join(latest(w), "report.md"))` contains `Result: failed (exit 1): the push of debaser to origin failed`.
  - `build.test.ts`, extend the first build test (line 34): from `latest(w)/result.json`, the `other/widget:topic` patch has no `pr` and `link: "https://github.com/other/widget/tree/topic"`; the `acme/widget#1` patch has `pr: { state: "OPEN", url: expect.any(String) }`.
- [ ] **Step 2:** Run them. Expected: FAIL on all three.
- [ ] **Step 3: Implement.**
  - `status.ts` command: `prState` for a `pr` source is `prInfo(...)?.state ?? "UNKNOWN"`. View: `UNKNOWN` renders as `unknown` (tone dim); `null` stays `not a PR`.
  - `report.ts`: the result line uses the same mapping as `outcome`: `Result: ${r.code === 1 ? "failed" : "stopped"} (exit ${r.code}): ...`.
  - `report.ts:250`: `pr` only when `p.source.kind === "pr"`; any other source with a `prLink` gets `link: p.prLink`.
  - `data-model.md`: add `link?: url` beside `pr?` in the `result.json` patch shape, with "for non-PR sources that have a web link (fork branches)".
- [ ] **Step 4:** Run `tests/integration/status.test.ts` and `tests/integration/build.test.ts` in full, plus `tests/integration/harness.test.ts` (asserts `Result: stopped (exit 2)`). Expected: PASS.
- [ ] **Step 5:** Commit `fix(report): agree on PR state and failed pushes across status, report.md and result.json` with `Fixes #8`.

### Task 5: #3 no diverged warning for debaser's own pending rebase

**Files:**
- Create: `src/rebase/pending.ts`
- Modify: `src/rebase/rebase.ts:210-215`, `src/plugins/sources/branch.ts:46-50`, `src/cli/commands/status.ts:36-42`, `src/views/status.ts:12,92`
- Test: `tests/integration/build.test.ts`, `tests/integration/status.test.ts`

**Interfaces:**
- Produces: `pushPending(repo: string, branch: string, local: string | null, pushed: string | null): boolean` in `src/rebase/pending.ts`: true when `refs/debaser/rebased/<branch>` exists, is an ancestor of `local`, `local !== pushed`, and `refs/debaser/rebase-lease/<branch>` equals `pushed`. Uses `git.refs` names (`rebasedRef`, `leaseRef` as in `rebase.ts`).
- Produces: view `Own` gains `{ kind: "checking" }`, rendered `· rebasing, checking` (tone null).

- [ ] **Step 1: Tests.**
  - `build.test.ts` `"a build after a rebase whose push is pending notes it instead of warning about divergence"`: `branch(w, "mine", ...)`, push to origin, `upstreamMoves`, `configureOwn(w, ["mine"])`, `runWith(w, { ask: () => "n" }, "rebase")`, then `runWith(w, { ask: () => "n" }, "build")`: `out` contains `note: mine: rebased earlier, push pending; using the local branch` and not `have diverged`.
  - `status.test.ts` `"status shows a branch under an in-worktree rebase check as rebasing, checking"`: a diverged own branch (built as in `build.test.ts:268-274`), then `git(w.clone, "update-ref", "refs/debaser/rebase-checking/diverged", <local sha>)`, `run(w, "status")`: row matches `/rebasing, checking/`, not `diverged from origin`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** `rebase.ts` computes `pending` with `pushPending(e.repo, branch, local, pushed)`. In `branch.ts`, before the diverged warning: when `pushPending(repo, s.name, local, pushed)` push the note `rebased earlier, push pending; using the local branch` and skip the warning. In the status command, `ownState` returns `{ kind: "checking" }` when `r.diverged` and `refs/debaser/rebase-checking/<branch>` resolves (pass the repo in).
- [ ] **Step 4:** Run `tests/integration/build.test.ts`, `tests/integration/rebase.test.ts`, `tests/integration/status.test.ts`. Expected: PASS, including the real-divergence warning at `build.test.ts:279`.
- [ ] **Step 5:** Commit `fix(sources): don't warn diverged for a rebase debaser made and has not pushed` with `Fixes #3`.

### Task 6: #1 `after_build = []` switches the inherited command off

**Files:**
- Modify: `src/recipes/schema.ts:30`, `src/recipes/resolve.ts:40-43`, `src/views/recipe.ts:48`, `src/run/finish.ts:62`, `src/run/live.ts:106,112`, `README.md` (the `after_build` paragraph)
- Test: `src/recipes/resolve.test.ts`, `tests/integration/recipes.test.ts`

- [ ] **Step 1: Tests.**
  - `resolve.test.ts` `"an empty after_build in a higher layer clears the inherited command"`: `resolve({ checkout: project({}), repo: "tals/corgi", local: "after_build = []\n" })` has `afterBuild` `[]` and `provenance.after_build` `"local"`. With `local: 'after_build = "x"\n'` it throws `after_build must be an array of strings`; with `after_build = [1]` the same.
  - `recipes.test.ts` `"after_build = [] in the local override runs no after-build command and shows none"`: publish an upstream recipe via `recipeText({ afterBuild: ["sh", "-c", `echo ran >> ${file}`] })` committed as `.debaser/recipe.toml`, `configure(w, ["mine"], { afterBuild: [] })`, `run(w, "build", "--trust-recipe")`: code 0, `existsSync(file)` false, `out` lacks `after-build`; `run(w, "recipe")` matches `/^after_build +none +local$/m`; `recipe --json` has `afterBuild: []`.
- [ ] **Step 2:** Run them. Expected: FAIL (schema refuses the empty list).
- [ ] **Step 3: Implement.** Schema: `after_build` goes through `list` instead of `command`. Resolve: `if (r.after_build)` stays (an empty array is truthy and clears). View: `after_build` row shows `none` when the list is empty. `finish.ts` and `live.ts`: test `recipe.afterBuild?.length`. README: one sentence that `after_build = []` in a higher layer switches an inherited command off.
- [ ] **Step 4:** Run `src/recipes/resolve.test.ts`, `tests/integration/recipes.test.ts`, `src/live/state.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(recipes): let after_build = [] switch an inherited command off` with `Fixes #1`.

### Task 7: #4 README and docs drift

**Files:**
- Modify: `README.md`, `docs/harness.md:43`, `docs/pilots.md:33`

- [ ] **Step 1:** Apply the nine items of #4 with the issue's proposed wording, adjusted where earlier tasks changed things: `list` row gets `--verbose`, `--retired`; `rebase` row `--skip-branch`, `--trust-recipe`; `continue` row `--trust-recipe`; exit 1 row adds a failed push of the integration branch with `build --push`; data directory tree adds `lock` and `work/`; `gh` is optional for PR sources; agent rebase-conflict resolutions are folded into the replayed commit; `after_build` runs as written in the build directory, without placeholders, timeout or `DEBASER_*` step variables; `docs/harness.md` notes a task entry without `kind` uses `plain`; `docs/pilots.md` runs `../rtk-debaser/dist/rtk-custom --version`.
- [ ] **Step 2:** Install section: drop the release-binary sentence; "build it from source with Bun 1.4.4 (the version CI tests with); release binaries are planned in #12".
- [ ] **Step 3:** `rg -n "—|–" README.md docs/harness.md docs/pilots.md` shows no new dash in edited lines.
- [ ] **Step 4:** Commit `docs: fix README and docs drift` with `Fixes #4`.

### Task 8: Verify and open the PR

- [ ] **Step 1:** `bun run typecheck` and `bun test`. Expected: all pass.
- [ ] **Step 2:** `git push -u origin fix/quick-issues`; draft the PR description (one section per issue, `Fixes #1`, `#3` to `#8`) and show it to the owner before `gh pr create`.
