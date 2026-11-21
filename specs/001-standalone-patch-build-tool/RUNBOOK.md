---
runbook_version: 1
feature: 001-standalone-patch-build-tool
status: stale
mode: light
steps_total: 13
step_results: pending,pending,pending,pending,pending,pending,pending,pending,pending,pending,pending,pending,pending
drafted_at: 670d520
drafted_fingerprint: 2d79739869a74e03dca6d4a59bf138ea100422ae17284b6ed688115c5567a07e
tested_at:
tested_fingerprint:
updated: 2026-11-21
stale_reason: spec evolved 2026-11-21: FR-014/015/026/027/045/048 → FR-055..060, added FR-061/062, SC-002/003/008 → SC-009..012
---

# Try it: debaser v1, a standalone tool for patched builds

<!-- runbook-status -->
> **Status:** stale · 0 of 13 steps · Mode: light · Drafted at 670d520 · 2026-11-21 · Reset: spec evolved 2026-11-21: FR-014/015/026/027/045/048 → FR-055..060, added FR-061/062, SC-002/003/008 → SC-009..012; step results below predate it
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

**Result:**

### Step 2 of 13: Create the sandbox repositories (US1)

**Why this step:** debaser needs an upstream, your fork as `origin`, and patches of different kinds. Local bare repositories stand in for GitHub.

**Needs:** Step 1; run from the feature worktree root.

**Run:**

```
SB="${TMPDIR:-/tmp}/debaser-try"; rm -rf "$SB"; mkdir -p "$SB/bin" "$SB/github/acme" "$SB/github/me" "$SB/github/other" && cp dist/debaser "$SB/bin/" && for r in acme me other; do git init -q --bare -b main "$SB/github/$r/widget.git"; done && git init -q -b main "$SB/seed" && cd "$SB/seed" && git config user.email tester@example.com && git config user.name Tester && git config commit.gpgsign false && printf 'one\ntwo\nthree\n' > base.txt && printf 'dist/\nout/\n' > .gitignore && git add -A && git commit -qm base && git push -q "$SB/github/acme/widget.git" main && git checkout -qb fix-b && echo beta > b.txt && git add b.txt && git commit -qm "fix-b: add beta" && git push -q "$SB/github/other/widget.git" fix-b && git checkout -q main && git clone -q -o upstream "$SB/github/acme/widget.git" "$SB/clone" && cd "$SB/clone" && git config user.email tester@example.com && git config user.name Tester && git config commit.gpgsign false && git remote add origin "$SB/github/me/widget.git" && git push -q origin main && git checkout -qb feature-a && echo alpha > a.txt && git add a.txt && git commit -qm "feature-a: add alpha" && git checkout -q main && git remote -v && git branch
```

**What you should see:** `git remote -v` lists `origin` pointing at `github/me/widget.git` and `upstream` at `github/acme/widget.git`; `git branch` lists `feature-a` and `* main`.

**If you see something else:** a git error about an existing directory means an earlier sandbox is in the way (the command removes it first, so check permissions).

**Result:**

### Step 3 of 13: Add patches and list them (US1)

**Why this step:** the patch list is private to you and lives outside the working tree. The first `add` creates it.

**Needs:** Step 2.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser add feature-a "alpha feature" --upstream acme/widget && ../bin/debaser add "file://${TMPDIR:-/tmp}/debaser-try/github/other/widget.git#branch=fix-b" "beta fix from someone else" && ../bin/debaser list && ls "$(git rev-parse --git-common-dir)/debaser" && git status --short
```

**What you should see:** both `add` calls succeed; `list` shows two live patches in order (`feature-a` as an own branch, the `fix-b` fork branch); the data directory under `.git/debaser` holds `patches.json`; `git status --short` prints nothing (the patch list is not in the working tree).

**If you see something else:** a refusal about the upstream means `--upstream` was not taken; a refusal about the URL means `file://` fork URLs are rejected by the credentials check.

**Result:**

### Step 4 of 13: Give the project a recipe and inspect it (US7)

**Why this step:** a recipe says how to check and build the project. This sandbox matches no built-in recipe, so a local override recipe beside the patch list provides the steps. `recipe` shows where every value came from.

**Needs:** Step 3.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && printf '%s\n' 'steps_replace = true' '' '[artifact]' 'output = "out/app"' 'install = "dist/app"' '' '[[steps]]' 'name = "check"' 'run = ["sh", "-c", "! grep -rqs BROKEN --include=*.txt ."]' '' '[[steps]]' 'name = "build"' 'run = ["sh", "-c", "mkdir -p out && cat *.txt > \"$1\"", "build", "{output}"]' > "$(git rev-parse --git-common-dir)/debaser/recipe.toml" && ../bin/debaser recipe
```

**What you should see:** the effective recipe lists the steps `check` then `build`, artifact output `out/app` and install path `dist/app`, each marked as coming from the `local` layer.

**If you see something else:** "no recipe matches this project" means the local override was not found; a TOML error names the file and key.

**Result:**

### Step 5 of 13: Rebuild (US1, US5)

**Why this step:** the core loop: fetch upstream and every patch, rebase own branches, reset the integration branch to upstream, merge the patches in order, run the checks, build, and install the artifact.

**Needs:** Step 4.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser rebuild; echo "exit=$?"; git log --format=%s --first-parent -3 && cat dist/app && ls "$(git rev-parse --git-common-dir)/debaser/reports/latest"
```

**What you should see:** plain progress lines prefixed `debaser:` on stderr, then `exit=0`; the first-parent log shows `Merge fix-b...` (or the fork branch's display name) on top of `Merge feature-a: alpha feature`, on top of `base`; `dist/app` contains `alpha`, `beta`, and the base lines; `reports/latest` holds `report.md` and `result.json`.

**If you see something else:** exit 1 with a precondition message (dirty tree, lock, git version); exit 3 means a check failed (look at `reports/latest/steps/`).

**Result:**

### Step 6 of 13: Status at a glance (US6)

**Why this step:** `status` answers what needs patching and how far upstream moved, without changing anything.

**Needs:** Step 5.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && git rev-parse HEAD > /tmp/debaser-try-head && ../bin/debaser status; echo "exit=$?"; ../bin/debaser status --json | head -40; test "$(git rev-parse HEAD)" = "$(cat /tmp/debaser-try-head)" && echo "HEAD unchanged"
```

**What you should see:** one row per patch saying it still merges, its kind (own branch or someone else's), and the last check result; a summary that upstream has 0 new commits since the last build; the JSON form carries the same facts; `HEAD unchanged`.

**If you see something else:** a fetch error means `status` tried to fetch (it should not without `--fetch`).

**Result:**

### Step 7 of 13: Upstream moves and a patch conflicts (US2)

**Why this step:** the common failure: upstream changed a line your patch also changed. debaser must stop with exit 2, name the file, and leave a state you can continue or roll back.

**Needs:** Step 5.

**Run:**

```
SB="${TMPDIR:-/tmp}/debaser-try"; cd "$SB/clone" && git checkout -qb conflict-c upstream/main && sed -i.bak 's/^one$/one, patched/' base.txt && rm base.txt.bak && git commit -qam "conflict-c: patch line one" && git checkout -q debaser && cd "$SB/seed" && sed -i.bak 's/^one$/ONE from upstream/' base.txt && rm base.txt.bak && git commit -qam "upstream changes line one" && git push -q "$SB/github/acme/widget.git" main && cd "$SB/clone" && ../bin/debaser add conflict-c "patch line one" && ../bin/debaser rebuild; echo "exit=$?"; git status --short
```

**What you should see:** the rebase phase reports that `conflict-c` could not be rebased and keeps its old tip; the merge of `conflict-c` stops with `exit=2`, naming `base.txt` and offering `debaser continue` and `debaser rollback`; `git status --short` shows `base.txt` as unmerged (`UU`).

**If you see something else:** `exit=0` means no conflict happened (check that upstream really moved); exit 1 means a precondition refused the run.

**Result:**

### Step 8 of 13: Resolve by hand and continue (US2)

**Why this step:** without a harness, you resolve the conflict and `continue` finishes the same run.

**Needs:** Step 7.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && printf 'ONE from upstream, patched\ntwo\nthree\n' > base.txt && git add base.txt && ../bin/debaser continue; echo "exit=$?"; head -1 dist/app && git log --format=%s --first-parent -4
```

**What you should see:** `exit=0`; `dist/app` starts with `ONE from upstream, patched`; the first-parent log shows three `Merge ...` commits (feature-a, fix-b, conflict-c) on top of `upstream changes line one`.

**If you see something else:** a refusal saying the integration branch is not checked out, or a stop at a check (exit 3), which would point at the resolution.

**Result:**

### Step 9 of 13: A patch breaks a check (US2)

**Why this step:** a check that fails only with the patches applied is blamed on the patches, not on upstream. debaser reruns it once (flaky?), then on plain upstream, then stops with exit 3 and writes a prompt for fixing it with an agent.

**Needs:** Step 8.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && git checkout -qb broken-d upstream/main && echo "BROKEN on purpose" > d.txt && git add d.txt && git commit -qm "broken-d: add d" && git checkout -q debaser && ../bin/debaser add broken-d "breaks the check" && ../bin/debaser rebuild; echo "exit=$?"; ls "$(git rev-parse --git-common-dir)/debaser/reports/latest"
```

**What you should see:** the `check` step fails, is rerun, then passes on plain upstream; the run stops with `exit=3`, naming the `check` step and `broken-d` as the patch behind it, and pointing at a `fix-check.md` prompt; the latest report directory contains `fix-check.md` and `steps/`.

**If you see something else:** `exit=4` would mean the check also failed on plain upstream (it should not: upstream has no `BROKEN`).

**Result:**

### Step 10 of 13: Roll back to the last good build (US2)

**Why this step:** `rollback` returns the checkout and the installed artifact to the build that was current when the stopped run began.

**Needs:** Step 9.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser rollback; echo "exit=$?"; git log --format=%s --first-parent -1 && grep -c BROKEN dist/app; ls "$(git rev-parse --git-common-dir)/debaser/run.json" 2>&1 | tail -1
```

**What you should see:** `exit=0`; the integration branch's top commit is the `conflict-c` merge again; `grep -c BROKEN` prints `0`; `run.json` no longer exists ("No such file or directory").

**If you see something else:** a refusal about uncommitted changes means the stopped run left edits behind; the run stays continuable.

**Result:**

### Step 11 of 13: Let a harness fix the check (US3)

**Why this step:** with a harness configured, debaser asks the agent to fix a check that fails only on the patched tree, then verifies the result itself and commits it as a separate, marked commit. A tiny `plain` harness script stands in for an AI agent.

**Needs:** Step 10; `jq` installed.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && P="$(git rev-parse --git-common-dir)/debaser/patches.json" && jq '.harness = {"command": ["sh", "-c", "grep -rl BROKEN --include=*.txt . | while read f; do sed -i.bak s/BROKEN/fixed/ \"$f\" && rm \"$f.bak\"; done", "harness", "{prompt_file}"], "kind": "plain"}' "$P" > "$P.new" && mv "$P.new" "$P" && ../bin/debaser rebuild; echo "exit=$?"; git log --format='%s%n%b' -1 && ls "$(git rev-parse --git-common-dir)/debaser/reports/latest/handoffs" "$(git rev-parse --git-common-dir)/debaser/reports/latest/prompts"
```

**What you should see:** the run calls the harness for the `check` step, accepts its change, reruns every step, and ends with `exit=0`; the top commit is `debaser: fix check (agent)` with a `Fixed-By: harness` trailer; `handoffs/` holds a file for `broken-d` (build drift: the patch itself needs the fix); `prompts/` holds the prompt and the harness log.

**If you see something else:** `exit=5` means the harness ran out of attempts (its change was rejected; the log under `prompts/` says why); `exit=3` means the harness was not used.

**Result:**

### Step 12 of 13: A per-patch acceptance check (US4)

**Why this step:** project-wide checks say the combined build works; an acceptance check says one patch still does its job, run against the built artifact. Patches without one are reported as "unverified".

**Needs:** Step 11; `jq` installed.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser remove broken-d --reason "done trying" && P="$(git rev-parse --git-common-dir)/debaser/patches.json" && jq '(.patches[] | select(.source.name == "feature-a")).acceptance = {"run": ["sh", "-c", "grep -q alpha \"$DEBASER_ARTIFACT\" && echo alpha is in"], "match": "alpha is in"}' "$P" > "$P.new" && mv "$P.new" "$P" && ../bin/debaser rebuild --json 2>/dev/null | jq '.outcome, .exitCode, [.patches[] | {display, acceptance}]'
```

**What you should see:** `"success"`, `0`, and a list where `feature-a` has `"acceptance": "pass"` while the fork branch and `conflict-c` show `"unverified"`; `broken-d` no longer appears as a live patch.

**If you see something else:** `exitCode` 6 means the acceptance check failed (check `reports/latest/acceptance/`); a `jq` error means the JSON shape differs from data-model.md.

**Result:**

### Step 13 of 13: The live view on a real terminal (US8)

**Why this step:** on a terminal, the same run is shown as a live view with stages, items, estimates from the recorded timings, and a final card pointing at the report.

**Needs:** Step 12; a real terminal window (not piped).

**Do:**

1. In a terminal, run `cd "${TMPDIR:-/tmp}/debaser-try/clone" && ../bin/debaser rebuild`.
2. Watch the view while it runs, then read the final card.
3. Run it once more with `--verbose` to see the view pinned above the full log.

**What you should see:** a timeline of the stages (fetch, rebase, merge, verify, accept), items ticking off with estimates taken from the earlier runs, and a final card that says the build succeeded and points at the report; the terminal is left clean afterwards.

**If you see something else:** plain `debaser:` lines instead of the view mean the terminal was not detected (check `NO_COLOR` and `TERM`).

**Result:**

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
