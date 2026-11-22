---
runbook_version: 1
feature: 001-standalone-patch-build-tool
status: passed
mode: light
steps_total: 13
step_results: passed,passed,passed,passed,passed,passed,passed,passed,passed,passed,passed,passed,passed
drafted_at: 670d520
drafted_fingerprint: 2d79739869a74e03dca6d4a59bf138ea100422ae17284b6ed688115c5567a07e
tested_at: e8c5832
tested_fingerprint: dc03cc46eba4212941f679a1677a8b936da90387591dd807136e17b849b013ad
updated: 2026-11-22
---

# Try it: debaser v1, a standalone tool for patched builds

<!-- runbook-status -->
> **Status:** passed · 13 of 13 steps (13 passed) · Mode: light · Tested at e8c5832 · 2026-11-22
<!-- /runbook-status -->















## What you're testing

debaser keeps a patched build of someone else's project: upstream plus your patch list, merged in order, checked, and installed as a runnable artifact. This journey builds the binary, creates a throwaway "GitHub" of local bare repositories (an upstream, your fork, and someone else's fork), and then walks through a patched project's life:

1. Add patches and give the project a recipe.
2. Rebuild, and see the installed artifact and the status view.
3. Upstream moves and a patch conflicts: debaser stops, you fix it, `continue` finishes.
4. A patch breaks a check: debaser stops and blames it, `rollback` returns to the last good build.
5. An agent harness (a small script standing in for an AI agent) fixes the check, and debaser verifies and records the fix.
6. A per-patch acceptance check runs against the artifact.
7. The live view on a real terminal.

Everything runs locally; no network, no `gh`, no paid agent.

## Test environment

No services or containers. Step 2 creates a sandbox directory, `${TMPDIR:-/tmp}/debaser-try`, holding three bare repositories under `github/`, a `seed` working copy (stands in for upstream's developers) and `clone` (your checkout). Teardown: `rm -rf "${TMPDIR:-/tmp}/debaser-try"`.

## Steps

### Step 1 of 13: Build the binary (US1)

**Why this step:** debaser ships as one self-contained executable; everything after this uses it.

**Needs:** Bun installed; run from the feature worktree root.

**Run:**

```
bun install && bun run build && ./dist/debaser --version && ls -lh dist/debaser
```

**What you should see:** the build finishes without errors, `--version` prints a version line, and `dist/debaser` is a single file of roughly 85 to 90 MB.

**If you see something else:** a TypeScript or bundle error means the branch does not build; `command not found: bun` means Bun is missing.

**Result:** passed (agent). Expected vs actual: ✔ build without errors → `bundle 107 modules`, `compile dist/debaser`; ✔ version line → `debaser 0.1.0`; ✔ single file 85 to 90 MB → `dist/debaser 85.5M`.

### Step 2 of 13: Create the sandbox repositories (US1)

**Why this step:** debaser needs an upstream, your fork as `origin`, and patches of different kinds. Local bare repositories stand in for GitHub.

**Needs:** Step 1; run from the feature worktree root.

**Run:**

```
SB="${TMPDIR:-/tmp}/debaser-try"; rm -rf "$SB"; mkdir -p "$SB/bin" "$SB/github/acme" "$SB/github/me" "$SB/github/other" && cp dist/debaser "$SB/bin/" && for r in acme me other; do git init -q --bare -b main "$SB/github/$r/widget.git"; done && git init -q -b main "$SB/seed" && cd "$SB/seed" && git config user.email tester@example.com && git config user.name Tester && git config commit.gpgsign false && printf 'one\ntwo\nthree\n' > base.txt && printf 'dist/\nout/\n' > .gitignore && git add -A && git commit -qm base && git push -q "$SB/github/acme/widget.git" main && git checkout -qb fix-b && echo beta > b.txt && git add b.txt && git commit -qm "fix-b: add beta" && git push -q "$SB/github/other/widget.git" fix-b && git checkout -q main && git clone -q -o upstream "$SB/github/acme/widget.git" "$SB/clone" && cd "$SB/clone" && git config user.email tester@example.com && git config user.name Tester && git config commit.gpgsign false && git remote add origin "$SB/github/me/widget.git" && git push -q origin main && git checkout -qb feature-a && echo alpha > a.txt && git add a.txt && git commit -qm "feature-a: add alpha" && git checkout -q main && git remote -v && git branch
```

**What you should see:** `git remote -v` lists `origin` pointing at `github/me/widget.git` and `upstream` at `github/acme/widget.git`; `git branch` lists `feature-a` and `* main`.

**If you see something else:** a git error about an existing directory means an earlier sandbox is in the way (the command removes it first, so check permissions).

**Result:** passed (agent). Expected vs actual: ✔ origin → `github/me/widget.git`, upstream → `github/acme/widget.git`; ✔ branches → `feature-a`, `* main`.

### Step 3 of 13: Add patches and list them (US1)

**Why this step:** the patch list is private to you and lives outside the working tree. The first `add` creates it.

**Needs:** Step 2.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser add feature-a "alpha feature" --upstream acme/widget && ../bin/debaser add "file://${TMPDIR:-/tmp}/debaser-try/github/other/widget.git#branch=fix-b" "beta fix from someone else" && ../bin/debaser list && ls "$(git rev-parse --git-common-dir)/debaser" && git status --short
```

**What you should see:** both `add` calls succeed; `list` shows two live patches in order (`feature-a` as an own branch, the `fix-b` fork branch); the data directory under `.git/debaser` holds `patches.json`; `git status --short` prints nothing (the patch list is not in the working tree).

**If you see something else:** a refusal about the upstream means `--upstream` was not taken; a refusal about the URL means `file://` fork URLs are rejected by the credentials check.

**Result:** passed (agent). Expected vs actual: ✔ both adds succeed → `added feature-a: alpha feature`, `added file:///…/other/widget.git:fix-b: beta fix from someone else`; ✔ two live patches in order → `debaser · 2 patches, merged in this order onto upstream/main`, rows 1 `feature-a`, 2 the fork branch, both marked `(unverified)` (no acceptance check yet); ✔ data directory → `patches.json` under `.git/debaser`; ✔ `git status --short` printed nothing. Note: `list` does not print the patch kind (own branch vs fork branch); the expectation's wording only described the patches.

### Step 4 of 13: Give the project a recipe and inspect it (US7)

**Why this step:** a recipe says how to check and build the project. This sandbox matches no built-in recipe, so a local override recipe beside the patch list provides the steps. `recipe` shows where every value came from.

**Needs:** Step 3.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && printf '%s\n' 'steps_replace = true' '' '[artifact]' 'output = "out/app"' 'install = "dist/app"' '' '[[steps]]' 'name = "check"' 'run = ["sh", "-c", "! grep -rn BROKEN --include=*.txt ."]' '' '[[steps]]' 'name = "build"' 'run = ["sh", "-c", "mkdir -p out && cat *.txt > \"$1\"", "build", "{output}"]' > "$(git rev-parse --git-common-dir)/debaser/recipe.toml" && ../bin/debaser recipe
```

**What you should see:** the effective recipe lists the steps `check` then `build`, artifact output `out/app` and install path `dist/app`, each marked as coming from the `local` layer.

**If you see something else:** "no recipe matches this project" means the local override was not found; a TOML error names the file and key.

**Result:** passed (agent). Expected vs actual: ✔ steps `check` then `build`, layer `local`; ✔ `artifact.output out/app` and `artifact.install dist/app`, layer `local` (header `debaser recipe · local`); `project_name widget` comes from the `default` layer.

### Step 5 of 13: Rebuild (US1, US5)

**Why this step:** the core loop: fetch upstream and every patch, rebase own branches, reset the integration branch to upstream, merge the patches in order, run the checks, build, and install the artifact.

**Needs:** Step 4.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser rebuild; echo "exit=$?"; git log --format=%s --first-parent -3 && cat dist/app && ls "$(git rev-parse --git-common-dir)/debaser/reports/latest"
```

**What you should see:** plain progress lines prefixed `debaser:` on stderr, then `exit=0`; the first-parent log shows `Merge fix-b...` (or the fork branch's display name) on top of `Merge feature-a: alpha feature`, on top of `base`; `dist/app` contains `alpha`, `beta`, and the base lines; `reports/latest` holds `report.md` and `result.json`.

**If you see something else:** exit 1 with a precondition message (dirty tree, lock, git version); exit 3 means a check failed (look at `reports/latest/steps/`).

**Result:** passed (agent). Expected vs actual: ✔ plain `debaser:` progress lines (fetch, reset to `upstream/main (8d37285)`, merge, `running check`, `running build`) then `exit=0`; ✔ first-parent log → `Merge file:///…/other/widget.git:fix-b: beta fix from someone else`, `Merge feature-a: alpha feature`, `base`; ✔ `dist/app` → `alpha`, `beta`, `one`, `two`, `three`; ✔ `reports/latest` → `report.md`, `result.json`, `steps`. The summary also lists both patches as `unverified (no acceptance check)`. No rebase lines appeared: `feature-a` is already on the current upstream, so there was nothing to rebase.

### Step 6 of 13: Status at a glance (US6)

**Why this step:** `status` answers what needs patching and how far upstream moved, without changing anything.

**Needs:** Step 5.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && git rev-parse HEAD > /tmp/debaser-try-head && ../bin/debaser status; echo "exit=$?"; ../bin/debaser status --json | head -40; test "$(git rev-parse HEAD)" = "$(cat /tmp/debaser-try-head)" && echo "HEAD unchanged"
```

**What you should see:** one row per patch saying it still merges, its kind (own branch or someone else's), and the last check result; a summary that upstream has 0 new commits since the last build; the JSON form carries the same facts; `HEAD unchanged`.

**If you see something else:** a fetch error means `status` tried to fetch (it should not without `--fetch`).

**Result:** passed (agent). Expected vs actual: ✔ one row per patch → both `✓ clean`, `feature-a` own branch `✓ up to date`, the fork branch `-` (not own), `CHECKS pass`, `ACCEPTANCE unverified`, `PR not a PR`; ✔ summary → `0 upstream commits since the last build`; ✔ JSON carries the same facts (`merges: true`, `rebase: "current"`, `checks: "pass"`); ✔ `HEAD unchanged`. With `--json` the human table goes to stderr and stdout is pure JSON (checked separately: `status --json 2>/dev/null | jq` parses).

### Step 7 of 13: Upstream moves and a patch conflicts (US2)

**Why this step:** the common failure: upstream changed a line your patch also changed. debaser must stop with exit 2, name the file, and leave a state you can continue or roll back.

**Needs:** Step 5.

**Run:**

```
SB="${TMPDIR:-/tmp}/debaser-try"; cd "$SB/clone" && git checkout -qb conflict-c upstream/main && sed -i.bak 's/^one$/one, patched/' base.txt && rm base.txt.bak && git commit -qam "conflict-c: patch line one" && git checkout -q debaser && cd "$SB/seed" && sed -i.bak 's/^one$/ONE from upstream/' base.txt && rm base.txt.bak && git commit -qam "upstream changes line one" && git push -q "$SB/github/acme/widget.git" main && cd "$SB/clone" && ../bin/debaser add conflict-c "patch line one" && ../bin/debaser rebuild; echo "exit=$?"; git status --short
```

**What you should see:** the rebase phase tries `conflict-c` (`rebasing conflict-c onto upstream`), cannot rebase it and keeps its old tip (the report's "Rebased branches" section says so); the merge of `conflict-c` stops with `exit=2`, naming `base.txt` and offering `debaser continue` and `debaser rollback`; `git status --short` shows `base.txt` as unmerged (`UU`).

**If you see something else:** `exit=0` means no conflict happened (check that upstream really moved); exit 1 means a precondition refused the run.

**Result:** passed (agent). Expected vs actual: ✔ `rebasing conflict-c onto upstream (96cbdba)`, then the report's "Rebased branches" says `conflict-c: not rebased: rebase conflict at 96cbdba conflict-c: patch line one in base.txt` and the branch stays at `96cbdba`; ✔ `debaser stopped: merge conflict in conflict-c`, `files: base.txt`, `exit=2`, with `continue: debaser continue` and `undo the run: debaser rollback` plus a ready-to-run `fix-conflict.md` agent prompt and a `handoffs/conflict-c.md` rebase handoff; ✔ `git status --short` → `UU base.txt`. Runbook corrected: the expectation assumed a console line about the failed rebase; that outcome is reported in report.md, which the spec allows (US5/AS3).

### Step 8 of 13: Resolve by hand and continue (US2)

**Why this step:** without a harness, you resolve the conflict and `continue` finishes the same run.

**Needs:** Step 7.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && printf 'ONE from upstream, patched\ntwo\nthree\n' > base.txt && git add base.txt && ../bin/debaser continue; echo "exit=$?"; grep "patched" dist/app && git log --format=%s --first-parent -4
```

**What you should see:** `exit=0`; `dist/app` contains the resolved line `ONE from upstream, patched`; the first-parent log shows three `Merge ...` commits (feature-a, fix-b, conflict-c) on top of `upstream changes line one`.

**If you see something else:** a refusal saying the integration branch is not checked out, or a stop at a check (exit 3), which would point at the resolution.

**Result:** passed (agent). Expected vs actual: ✔ `exit=0` after `running check`, `running build`, `built dist/app on upstream 0dcd35a with 3 patches`; ✔ resolved line in the artifact → `ONE from upstream, patched` (line 3 of `dist/app`); ✔ first-parent log → `Merge conflict-c: patch line one`, `Merge …fix-b…`, `Merge feature-a: alpha feature`, `upstream changes line one`. The summary also reports `rebased feature-a: 31a152c to 38c3cda (clean)` with an undo command, a ready lease-push command for it (not run), and the `conflict-c` rebase handoff. Runbook corrected: the old command checked `head -1 dist/app`, but the sandbox build concatenates `*.txt` alphabetically, so `alpha` comes first; the step now greps for the resolved line.

### Step 9 of 13: A patch breaks a check (US2)

**Why this step:** a check that fails only with the patches applied is blamed on the patches, not on upstream. debaser reruns it once (flaky?), then on plain upstream, then stops with exit 3 and writes a prompt for fixing it with an agent.

**Needs:** Step 8.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && git checkout -qb broken-d upstream/main && echo "BROKEN on purpose" > d.txt && git add d.txt && git commit -qm "broken-d: add d" && git checkout -q debaser && ../bin/debaser add broken-d "breaks the check" && ../bin/debaser rebuild; echo "exit=$?"; ls "$(git rev-parse --git-common-dir)/debaser/reports/latest"
```

**What you should see:** the `check` step fails, is rerun, then passes on plain upstream; the run stops with `exit=3`, naming the `check` step and `broken-d` as the patch behind it, and pointing at a `fix-check.md` prompt; the latest report directory contains `fix-check.md` and `steps/`.

**If you see something else:** `exit=4` would mean the check also failed on plain upstream (it should not: upstream has no `BROKEN`).

**Result:** passed on retry (agent). First run: ✔ check failed, flaky rerun, plain-upstream rerun, `exit=3`, `fix-check.md`; ✘ no patch named (`no merged patch touches what the check fix changed or the failure names; not attributed`), because the sandbox check used `grep -q` and its log named no file. Fix: the step 4 recipe now uses `grep -rn`, so the failure prints `./d.txt:1:BROKEN on purpose` (runbook corrected). Retry after `debaser rollback`: ✔ `running check with broken-d alone on upstream (1 of 1, 0 left)`; ✔ `debaser stopped: check failed`, `caused by: broken-d fails alone on upstream`, exit code 3 (`result.json`), with a `handoffs/broken-d.md` build-drift handoff and the `fix-check.md` agent prompt; ✔ report directory holds `fix-check.md` and `steps/`. Side note for the backlog: at a plain stop the "not attributed" message speaks of "what the check fix changed" although no fix was made.

### Step 10 of 13: Roll back to the last good build (US2)

**Why this step:** `rollback` returns the checkout and the installed artifact to the build that was current when the stopped run began.

**Needs:** Step 9.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser rollback; echo "exit=$?"; git log --format=%s --first-parent -1 && grep -c BROKEN dist/app; ls "$(git rev-parse --git-common-dir)/debaser/run.json" 2>&1 | tail -1
```

**What you should see:** `exit=0`; the integration branch's top commit is the `conflict-c` merge again; `grep -c BROKEN` prints `0`; `run.json` no longer exists ("No such file or directory").

**If you see something else:** a refusal about uncommitted changes means the stopped run left edits behind; the run stays continuable.

**Result:** passed (agent). Expected vs actual: ✔ `debaser: rolled back to debaser at 145dda7, as before the run`, `exit=0`; ✔ top commit → `Merge conflict-c: patch line one`; ✔ `grep -c BROKEN dist/app` → `0`; ✔ `run.json` gone (the `ls` line printed nothing through a shell wrapper, so it was confirmed with `test -e`: `run.json gone`); working tree clean.

### Step 11 of 13: Let a harness fix the check (US3)

**Why this step:** with a harness configured, debaser asks the agent to fix a check that fails only on the patched tree, then verifies the result itself and commits it as a separate, marked commit. A tiny `plain` harness script stands in for an AI agent.

**Needs:** Step 10; `jq` installed.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && P="$(git rev-parse --git-common-dir)/debaser/patches.json" && jq '.harness = {"command": ["sh", "-c", "grep -rl BROKEN --include=*.txt . | while read f; do sed -i.bak s/BROKEN/fixed/ \"$f\" && rm \"$f.bak\"; done", "harness", "{prompt_file}"], "kind": "plain"}' "$P" > "$P.new" && mv "$P.new" "$P" && ../bin/debaser rebuild; echo "exit=$?"; git log --format='%s%n%b' -1 && ls "$(git rev-parse --git-common-dir)/debaser/reports/latest/handoffs" "$(git rev-parse --git-common-dir)/debaser/reports/latest/prompts"
```

**What you should see:** the run calls the harness for the `check` step, accepts its change, reruns every step, and ends with `exit=0`; the top commit is `debaser: fix check (agent)` with a `Fixed-By: harness` trailer; `handoffs/` holds a file for `broken-d` (build drift: the patch itself needs the fix); `prompts/` holds the prompt and the harness log.

**If you see something else:** `exit=5` means the harness ran out of attempts (its change was rejected; the log under `prompts/` says why); `exit=3` means the harness was not used.

**Result:** passed (agent). Expected vs actual: ✔ harness called for the check after the plain-upstream rerun passed → `asking the harness to fix check (attempt 1 of 3)`, then every step reruns (`running check`, `running build`); ✔ exit code 0 (`result.json`); ✔ top commit → `debaser: fix check (agent)` with trailer `Fixed-By: harness`, reported as `agent fix d0190ce for check`; ✔ `handoffs/broken-d.md` after `running check with broken-d alone on upstream (1 of 1, 0 left)` (build drift); ✔ `prompts/` → `01-check.md` (prompt) and `01-check.log` (harness log; no `.jsonl` for the plain kind). Bonus: `conflict-c` was rebased this time (`b20039a`) because rerere replayed the resolution from step 8; both own branches now show a pending lease push with an undo command (nothing pushed).

### Step 12 of 13: A per-patch acceptance check (US4)

**Why this step:** project-wide checks say the combined build works; an acceptance check says one patch still does its job, run against the built artifact. Patches without one are reported as "unverified".

**Needs:** Step 11; `jq` installed.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser remove broken-d --reason "done trying" && P="$(git rev-parse --git-common-dir)/debaser/patches.json" && jq '(.patches[] | select(.source.name == "feature-a")).acceptance = {"run": ["sh", "-c", "grep -q alpha \"$DEBASER_ARTIFACT\" && echo alpha is in"], "match": "alpha is in"}' "$P" > "$P.new" && mv "$P.new" "$P" && ../bin/debaser rebuild --json 2>/dev/null | jq '.outcome, .exitCode, [.patches[] | {display, acceptance}]'
```

**What you should see:** `"success"`, `0`, and a list where `feature-a` has `"acceptance": "pass"` while the fork branch and `conflict-c` show `"unverified"`; `broken-d` is listed only as retired (`state: "retired"`, acceptance `skipped`), not merged.

**If you see something else:** `exitCode` 6 means the acceptance check failed (check `reports/latest/acceptance/`); a `jq` error means the JSON shape differs from data-model.md.

**Result:** passed (agent). Expected vs actual: ✔ `retired broken-d: done trying`; ✔ `"success"`, `0`; ✔ `feature-a` → `"acceptance": "pass"` (the check ran against `$DEBASER_ARTIFACT`); ✔ fork branch and `conflict-c` → `"unverified"`; ✔ `broken-d` not merged: it appears with `state: "retired"` and acceptance `skipped`, and `list` shows it under "1 retired patch" with reason `done trying`. Runbook wording sharpened: a retired patch still appears in `result.json`, marked retired.

### Step 13 of 13: The live view on a real terminal (US8)

**Why this step:** on a terminal, the same run is shown as a live view with stages, items, estimates from the recorded timings, and a final card pointing at the report.

**Needs:** Step 12; a real terminal window (not piped).

**Do:**

1. In a terminal, run `cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser rebuild`.
2. Watch the view while it runs, then read the final card.
3. Run it once more with `--verbose` to see the view pinned above the full log.

**What you should see:** a timeline of the stages (fetch, rebase, merge, verify, accept), items ticking off with estimates taken from the earlier runs, and a final card that says the build succeeded and points at the report; the terminal is left clean afterwards.

**If you see something else:** plain `debaser:` lines instead of the view mean the terminal was not detected (check `NO_COLOR` and `TERM`).

**Result:** passed (user). The user ran `../bin/debaser rebuild` and the `--verbose` variant in a real terminal and reported that the live view, the final card and the terminal state "looked right".

## Not covered here

- **Upstream PRs and PR state through `gh`**: needs GitHub or a fake `gh`; covered by the integration tests (`tests/integration/patchlist.test.ts`, `rebuild.test.ts`) with a stubbed `gh`.
- **Real AI agents (claude, codex, pi, opencode)**: they cost money and need logins; the stream parsing is covered by the adapter unit tests in `src/plugins/harness/`, and `docs/harness.md` has a safe example per agent.
- **Pushing rebased own branches with a lease**: needs an own branch behind upstream plus a push answer; covered by `tests/integration/rebase.test.ts`.
- **Trusting a recipe committed in the project's repository**: covered by `tests/integration/recipes.test.ts`.
- **The pilot projects (rtk and corgi, SC-002, SC-003, SC-008)**: need real forks and weeks of use; see `docs/pilots.md`.

## Coverage

- **Covered:** US1 (steps 1 to 5), US2 (steps 7 to 10), US3 (step 11), US4 (step 12), US5 partly (step 5 runs the rebase phase; step 7 shows an own branch that cannot be rebased keeping its old tip), US6 (step 6), US7 partly (step 4, local layer only), US8 (step 13).
- **Not covered by hand:** US5 lease pushes and in-worktree rebasing, and US7 project-repo recipes and trust, for the reasons above.

## Results

13 steps: 13 passed, 0 failed, 0 skipped (12 run by the agent, step 13 by the user), 2026-11-22.

debaser built a single binary, kept a private patch list in `.git/debaser`, and rebuilt a sandbox project from upstream plus four kinds of patches into an installed artifact. It stopped with the right exit codes and offers (exit 2 on a merge conflict, exit 3 on a check broken by a patch), named the patch behind a failing check by running it alone on upstream, rolled back to the last good build, let a harness fix a check and committed the fix as a separate, marked commit with a build-drift handoff, replayed a hand resolution through rerere on the next rebase, ran a per-patch acceptance check against the artifact, and showed the live view on a terminal.

Three runbook corrections were made while running (steps 7, 8 and 9): the expectations, not the tool, were wrong. Step 9 needed the sandbox check to print the failing file (`grep -rn` instead of `grep -q`) so attribution has something to work with; with a silent check debaser stops correctly but cannot name the patch. One wording nit for the backlog: at a plain stop with no attribution, the message says "what the check fix changed" although no fix was made.
