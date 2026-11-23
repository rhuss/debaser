---
runbook_version: 1
feature: 002-build-worktree
status: passed
mode: light
steps_total: 11
step_results: passed,passed,passed,passed,passed,passed,passed,passed,passed,passed,passed
drafted_at: e0842c8
drafted_fingerprint: 31f22deb4050b9b62b73b80275684094f0d9d5e5a07f393abbc845311cf8289a
tested_at: bc37917
tested_fingerprint: 737644580a959c154f11d5e838d4bb55d6f2d539e323da0d8c7e4a0a762733e8
updated: 2026-11-23
---

# Try it: a dedicated build directory and visible configuration

<!-- runbook-status -->
> **Status:** passed · 11 of 11 steps (11 passed) · Mode: light · Tested at bc37917 · 2026-11-23
<!-- /runbook-status -->












## What you're testing

debaser now builds in its own directory next to your project (`../<project>-debaser`), holding the integration branch, instead of in the checkout you start it from. Your checkout can be dirty and on any branch. Stops point at the build directory, and `list`, `status` and `recipe` show which files debaser reads. This journey:

1. Builds the binary and creates a local sandbox (upstream, your fork, a project checkout with patches and a recipe).
2. Shows the configuration header before anything was built.
3. Builds from a dirty checkout on a feature branch, then inspects the new build directory.
4. Builds again from inside the build directory.
5. Hits a merge conflict, resolves it in the build directory, and continues from the project checkout.
6. Reads the configuration and build-directory state as JSON.
7. Sees the refusal for an edited build directory.
8. Rolls back to the previous build from the project checkout.
9. Migrates an old-style setup, where the project checkout holds the integration branch.

Everything runs locally: no network, no `gh`, no agent.

## Test environment

No services or containers. Step 2 creates a sandbox directory, `${TMPDIR:-/tmp}/debaser-tree-try`, holding two bare repositories under `github/` (upstream `acme` and your fork `me`), a `seed` working copy for upstream, the project checkout `project`, and a copy of the binary in `bin/`. The build directory appears next to it as `project-debaser`. Teardown: `rm -rf "${TMPDIR:-/tmp}/debaser-tree-try"`.

## Steps

### Step 1 of 11: Build the binary (US1)

**Why this step:** every later step runs the compiled debaser from this branch.

**Needs:** Bun installed; run from the feature worktree root.

**Run:**

```
bun install && bun run build && ./dist/debaser --version
```

**What you should see:** the build finishes without errors and `--version` prints a version line.

**If you see something else:** a TypeScript or bundle error means the branch does not build; `command not found: bun` means Bun is missing.

**Result:** passed (agent). Expected vs actual: ✔ build without errors → `bundle 109 modules`, `compile dist/debaser`; ✔ version line → `debaser 0.1.0`.

### Step 2 of 11: Create the sandbox, patches and recipe (US1)

**Why this step:** debaser needs an upstream, your fork as `origin`, patch branches and a recipe. Local bare repositories stand in for GitHub. Two of the patches (`feature-c`, `feature-d`) change the same line, for the conflict later.

**Needs:** Step 1; run from the feature worktree root.

**Run:**

```
SB="${TMPDIR:-/tmp}/debaser-tree-try"; rm -rf "$SB"; mkdir -p "$SB/bin" "$SB/github/acme" "$SB/github/me" && cp dist/debaser "$SB/bin/" && for r in acme me; do git init -q --bare -b main "$SB/github/$r/widget.git"; done && git init -q -b main "$SB/seed" && cd "$SB/seed" && git config user.email tester@example.com && git config user.name Tester && git config commit.gpgsign false && printf 'one\ntwo\nthree\n' > base.txt && printf 'dist/\nout/\n' > .gitignore && git add -A && git commit -qm base && git push -q "$SB/github/acme/widget.git" main && git clone -q -o upstream "$SB/github/acme/widget.git" "$SB/project" && cd "$SB/project" && git config user.email tester@example.com && git config user.name Tester && git config commit.gpgsign false && git remote add origin "$SB/github/me/widget.git" && git push -q origin main && git checkout -qb feature-a && echo alpha > a.txt && git add a.txt && git commit -qm "feature-a: add alpha" && git checkout -q main -b feature-c && printf 'one\ntwo C\nthree\n' > base.txt && git commit -qam "feature-c: change two" && git checkout -q main -b feature-d && printf 'one\ntwo D\nthree\n' > base.txt && git commit -qam "feature-d: change two" && git checkout -q main && ../bin/debaser add feature-a "alpha feature" --upstream acme/widget && printf '%s\n' 'steps_replace = true' '' '[artifact]' 'output = "out/app"' 'install = "dist/app"' '' '[[steps]]' 'name = "check"' 'run = ["sh", "-c", "! grep -rn BROKEN --include=*.txt ."]' '' '[[steps]]' 'name = "build"' 'run = ["sh", "-c", "mkdir -p out && cat *.txt > \"$1\"", "build", "{output}"]' > "$(git rev-parse --git-common-dir)/debaser/recipe.toml" && git branch && ls "$(git rev-parse --git-common-dir)/debaser"
```

**What you should see:** `added feature-a: alpha feature`; `git branch` lists `feature-a`, `feature-c`, `feature-d` and `* main`; the data directory holds `patches.json` and `recipe.toml`.

**If you see something else:** a refusal about the upstream means `--upstream` was not taken; a git error about an existing directory means an earlier sandbox is in the way.

**Result:** passed (agent). Expected vs actual: ✔ `added feature-a: alpha feature`; ✔ branches → `feature-a`, `feature-c`, `feature-d`, `* main`; ✔ data directory → `patches.json`, `recipe.toml`.

### Step 3 of 11: See the configuration before the first build (US3)

**Why this step:** before anything is built, debaser already tells you which files it reads and where it will build.

**Needs:** Step 2.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && ../bin/debaser list | head -4 && ../bin/debaser recipe | head -1
```

**What you should see:** a header naming the data directory (`…/project/.git/debaser`), `patches.json`, the local recipe `…/.git/debaser/recipe.toml`, and a `build` line with `…/project-debaser (not created yet)`. The recipe's first line names its layer with its source, `local …/.git/debaser/recipe.toml`.

**If you see something else:** no header means the configuration display is missing; `(local recipe: none)` means the recipe from Step 2 was not found.

**Result:** passed (agent). Expected vs actual: ✔ header → `data …/project/.git/debaser`, `config …/patches.json (local recipe: …/recipe.toml)`, `build …/project-debaser (not created yet)`; ✔ recipe line → `debaser recipe · local …/.git/debaser/recipe.toml`. Note: the header has three lines (a `data` line was added during review for FR-017), not two.

### Step 4 of 11: Build from a dirty checkout on a feature branch (US1)

**Why this step:** this is the problem the feature solves. An edited tracked file and a feature branch used to block the build, and the build used to leave you on the integration branch.

**Needs:** Step 3.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && git switch -q -c my-work && echo "local edit" >> base.txt && ../bin/debaser build; echo "exit=$?"; git branch --show-current; git status --short
```

**What you should see:** progress lines that create the build directory (`creating the build directory …/project-debaser`) and name it with the patch list (`build directory …/project-debaser; patch list …/patches.json`), then `exit=0`. Afterwards the checkout is still on `my-work`, and `git status --short` still shows ` M base.txt`.

**If you see something else:** "tracked files have uncommitted changes" means the build still checks your checkout; ending on `debaser` means it still builds in place.

**Result:** passed (agent). Expected vs actual: ✔ `creating the build directory …/project-debaser from upstream/main`; ✔ `build directory …/project-debaser; patch list …/patches.json`; ✔ `exit=0`; ✔ checkout still on `my-work` with ` M base.txt`.

### Step 5 of 11: Look inside the build directory (US1)

**Why this step:** the build directory is the place to open and try the build. Its path is recorded in the patch list.

**Needs:** Step 4.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && git -C ../project-debaser branch --show-current && cat ../project-debaser/dist/app && jq .tree "$(git rev-parse --git-common-dir)/debaser/patches.json" && git worktree list
```

**What you should see:** the build directory is on `debaser`; `dist/app` holds `alpha` and the three base lines (`one`, `two`, `three`), without your local edit; the patch list has `"../project-debaser"`; `git worktree list` shows `project` on `my-work` and `project-debaser` on `debaser`.

**If you see something else:** your local edit in `dist/app` means the build read your checkout; `null` for `tree` means the path was not recorded.

**Result:** passed (agent). Expected vs actual: ✔ build directory on `debaser`; ✔ `dist/app` → `alpha`, `one`, `two`, `three` (no local edit); ✔ `tree` → `"../project-debaser"`; ✔ worktree list → `project [my-work]`, `project-debaser [debaser]`.

### Step 6 of 11: Build again from inside the build directory (US1)

**Why this step:** debaser works the same from the project checkout, the build directory or any other worktree of the project.

**Needs:** Step 5.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project-debaser" && ../bin/debaser build; echo "exit=$?"; git log --oneline -1
```

**What you should see:** `exit=0`, the same `build directory …/project-debaser` line, and the integration branch ends with the merge of `feature-a`.

**If you see something else:** a refusal about the branch being checked out means the build directory was not recognized as its own.

**Result:** passed (agent). Expected vs actual: ✔ `exit=0`; ✔ same `build directory …/project-debaser` line; ✔ tip → `Merge feature-a: alpha feature`.

### Step 7 of 11: A conflict stops and points at the build directory (US2)

**Why this step:** when a build stops, you must be told where to fix it. Now that is the build directory, not your checkout.

**Needs:** Step 6.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && ../bin/debaser add feature-c "change two, C" && ../bin/debaser add feature-d "change two, D" && ../bin/debaser build; echo "exit=$?"; git -C ../project-debaser status --short
```

**What you should see:** `exit=2`, a merge conflict in `feature-d` on `base.txt`, a `build directory: …/project-debaser` line, and a prompt file whose "run it" hint starts with `cd …/project-debaser`. In the build directory, `git status --short` shows `UU base.txt`. Your checkout is untouched (still `my-work`, ` M base.txt`).

**If you see something else:** a conflict shown in `project` instead of `project-debaser` means the merge ran in your checkout.

**Result:** passed (agent). Expected vs actual: ✔ `exit=2`, `merge conflict in feature-d`, `files: base.txt`; ✔ `build directory: …/project-debaser`; ✔ `run it: cd …/project-debaser && claude …`; ✔ build directory → `UU base.txt`; ✔ checkout still `my-work`, ` M base.txt`.

### Step 8 of 11: Resolve in the build directory, continue from the checkout (US2)

**Why this step:** you fix the conflict where it is and resume from wherever you are.

**Needs:** Step 7.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project-debaser" && printf 'one\ntwo C and D\nthree\n' > base.txt && git add base.txt && cd ../project && ../bin/debaser continue; echo "exit=$?"; cat ../project-debaser/dist/app
```

**What you should see:** `exit=0`, and `dist/app` in the build directory has `two C and D` and `alpha`.

**If you see something else:** "not checked out at this run's upstream" means `continue` looked at your checkout instead of the build directory.

**Result:** passed (agent). Expected vs actual: ✔ `continue` → `built dist/app on upstream 99fea10 with 3 patches`, `exit=0`; ✔ `dist/app` → `alpha`, `two C and D`.

### Step 9 of 11: Read the configuration and build directory as JSON (US3)

**Why this step:** scripts get the same paths and the build directory's state without parsing text.

**Needs:** Step 8.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && ../bin/debaser status --json 2>/dev/null | jq '.config' && ../bin/debaser recipe --json | jq '.layerSources'
```

**What you should see:** `config` with `dir`, `patchList`, `localRecipe` and `tree` (its `path` is `…/project-debaser`, `exists: true`, `branch: "debaser"`, no modified files); `layerSources` has a `local` entry with the recipe's path.

**If you see something else:** `null` means the JSON fields are missing.

**Result:** passed (agent). Expected vs actual: ✔ `config` → `dir`, `patchList`, `localRecipe`, `tree` with `path …/project-debaser`, `exists: true`, `branch: "debaser"`, `modified: []`; ✔ `layerSources.local.path` → the recipe's path. Note: like `status --json`, `recipe --json` also prints the human table on stderr.

### Step 10 of 11: An edited build directory is refused, then rollback (US2)

**Why this step:** debaser never discards your work, including edits in the build directory. Rollback returns to the previous build without touching your checkout.

**Needs:** Step 9.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && echo "experiment" >> ../project-debaser/a.txt && ../bin/debaser build; echo "exit=$?"; git -C ../project-debaser checkout -- a.txt && ../bin/debaser rollback; echo "exit=$?"; git -C ../project-debaser log --oneline -1; git branch --show-current
```

**What you should see:** the first build exits 1 with `the build directory …/project-debaser has uncommitted changes in: a.txt`. After the edit is discarded, `rollback` exits 0, the build directory's last commit is the build before the conflict run (the `feature-a` merge from Step 6), and your checkout is still on `my-work`.

**If you see something else:** a build that runs despite the edit means the build directory is not checked; a rollback that switches your checkout is the old behavior.

**Result:** passed (agent). Expected vs actual: ✔ build refused → `exit=1`, `has uncommitted changes in: a.txt`; ✔ rollback → `rolled back to debaser-prev (d7c97c5) and dist/app.prev`, `exit=0`; ✔ tip → `d7c97c5 Merge feature-a: alpha feature` (Step 6); ✔ checkout still on `my-work`.

### Step 11 of 11: Migrate an old-style setup (US4)

**Why this step:** older debaser versions left the integration branch checked out in your project. The first build after the update must refuse with a clear hint, then create the build directory from the existing branch.

**Needs:** Step 10.

**Run:**

```
cd "${TMPDIR:-/tmp}/debaser-tree-try/project" && git checkout -q -- base.txt && git worktree remove --force ../project-debaser && git switch -q debaser && ../bin/debaser build; echo "exit=$?"; git switch -q main && ../bin/debaser build; echo "exit=$?"; git -C ../project-debaser branch --show-current
```

**What you should see:** the first build exits 1 with `the main checkout (…/project) has debaser checked out; switch it away first: git -C … switch main`. After `git switch main`, the second build creates `…/project-debaser` from the existing `debaser` branch and exits 0, and the build directory is on `debaser`.

**If you see something else:** a build that starts while the project holds `debaser` means the migration check is missing; a build that ends on `debaser` in `project` means it built in place.

**Result:** passed (agent). Expected vs actual: ✔ refused → `exit=1`, `the main checkout (…/project) has debaser checked out; switch it away first: git -C … switch main`; ✔ after `git switch main` → `creating the build directory …/project-debaser from debaser (it was missing)`, `exit=0`; ✔ build directory on `debaser`. Note: git replayed the recorded `feature-d` resolution (rerere), so the second build merged all three patches without stopping.

## Not covered here

- In-place builds for CI (`"tree": "."`, US5) and the legacy stopped-run path (a run stopped by an older version, FR-014) are covered by the integration tests in `tests/integration/tree.test.ts`. Reproducing them by hand needs an older debaser binary.
- Harness fixes in the build directory need a stub agent script; `tests/integration/tree.test.ts` covers them.

## Coverage

- US1 (build without touching the checkout): Steps 4, 5, 6.
- US2 (stops, continue, rollback in the build directory): Steps 7, 8, 10.
- US3 (configuration display): Steps 3, 9.
- US4 (migration): Step 11.
- US5 (in place for CI): not covered here, see above.

## Results

All 11 steps passed (agent-run, 2026-11-23). From a dirty checkout on a feature branch, debaser built in `../project-debaser` and left the checkout untouched. Builds from the build directory gave the same result. A conflict stop named the build directory, was resolved there and continued from the checkout. `list`, `status` and `recipe` (text and JSON) showed the data directory, patch list, local recipe, layer sources and build directory. An edited build directory was refused, rollback restored the previous build without touching the checkout, and an old-style setup (project on the integration branch) was refused with a clear hint, then migrated without a rebuild from scratch.
