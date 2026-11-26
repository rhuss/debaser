---
runbook_version: 1
feature: 003-patch-ordering
status: passed
mode: light
steps_total: 9
step_results: passed,passed,passed,passed,passed,passed,passed,passed,passed
drafted_at: 18feffc
drafted_fingerprint: 18a5a2ae2dada1786c4a29b8ab88472d40e35bae4b767fc3c9ea582e659adc2c
tested_at: 7e39541
tested_fingerprint: 18a5a2ae2dada1786c4a29b8ab88472d40e35bae4b767fc3c9ea582e659adc2c
updated: 2026-11-26
---

# Try it: Managing the order of patches

<!-- runbook-status -->
> **Status:** passed · 9 of 9 steps (9 passed) · Mode: light · Tested at 7e39541 · 2026-11-26
<!-- /runbook-status -->










## What you're testing

debaser can now place patches where they belong instead of always appending them. You will build the binary, create a throwaway project with an upstream, a local clone and a fork, and then:

1. insert a patch at a chosen place with `add --after`,
2. move patches from the command line with `move`, including a refused move,
3. reorder interactively with numbered prompts,
4. ask `move --propose` for a conflict-reducing order, see it refuse unfetched patches, check that it changes no refs, and apply it,
5. run the feature's automated tests for the parts that need a real build (stopped-run guard, the build note).

Everything happens in a sandbox under `specs/003-patch-ordering/.walkthrough/sandbox`; your own checkouts are not touched.

## Test environment

No fixtures. Step 1 builds the binary in this worktree and step 2 creates the sandbox repositories with plain git; deleting `specs/003-patch-ordering/.walkthrough/sandbox` removes them.

## Steps

### Step 1 of 9: Build the debaser binary (US1)

**Why this step:** every later step runs the freshly built binary from this branch.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering && bun install && bun run build && ./dist/debaser --version
```

**What you should see:** the build finishes without errors and the last line is `debaser 0.1.0`.

**If you see something else:** a compile error means the branch does not build; `bun: command not found` means Bun 1.4+ is not installed.

**Result:** passed (agent). Build compiled 116 modules; last line `debaser 0.1.0`.

### Step 2 of 9: Create the sandbox project (US1)

**Why this step:** a small upstream repository (`acme/widget`), a clone with an `upstream` remote and own branches, and a fork whose branch `clash` changes the same line as the own branch `mine`.

**Needs:** Step 1.

**Run:**

```
rm -rf /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox && mkdir -p /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/acme && cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox && git init -q -b main up && printf 'line1\nline2\nline3\n' > up/app.txt && git -C up add . && git -C up -c user.name=t -c user.email=t@t commit -qm base && git clone -q --bare up acme/widget.git && git clone -q up forkwork && git -C forkwork switch -q -c clash && printf 'line1\nCLASH\nline3\n' > forkwork/app.txt && git -C forkwork -c user.name=t -c user.email=t@t commit -qam clash && git clone -q --bare forkwork fork.git && git clone -q acme/widget.git clone && cd clone && git remote rename origin upstream && git config user.name t && git config user.email t@t && for b in alpha beta gamma delta; do git switch -q -c $b main && echo $b > $b.txt && git add . && git commit -qm $b; done && git switch -q -c mine main && printf 'line1\nMINE\nline3\n' > app.txt && git commit -qam mine && git switch -q main && git branch --format='%(refname:short)'
```

**What you should see:** the branch list `alpha`, `beta`, `delta`, `gamma`, `main`, `mine` (one per line).

**If you see something else:** a git error usually means an older git; debaser needs 2.38 or newer.

**Result:** passed (agent). Branch list: alpha, beta, delta, gamma, main, mine.

### Step 3 of 9: Insert a patch at a chosen place (US1)

**Why this step:** `add --after` puts a new patch right where it belongs and prints the list with the new patch marked.

**Needs:** Step 2.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/clone && D=/Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser && $D add alpha "Alpha" && $D add beta "Beta" && $D add gamma "Gamma" && $D add delta "Delta" --after 1
```

**What you should see:** three `added ...` lines, then `added delta: Delta` followed by a numbered list in the order alpha, delta, beta, gamma, with the delta row shown as `>2`.

**If you see something else:** `no upstream remote` means step 2 did not rename the remote; delta at the end means `--after` was ignored.

**Result:** passed (agent). Four `added` lines; list alpha, `>2` delta, beta, gamma.

### Step 4 of 9: Move from the command line, and a refused move (US2)

**Why this step:** `move <patch> --after <patch>` reorders with one command; moving a patch relative to itself is refused.

**Needs:** Step 3.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/clone && D=/Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser && $D move 4 --after 1; $D move 2 --after 2; echo "exit $?"
```

**What you should see:** the list in the order alpha, gamma, delta, beta with gamma marked `>2`; then a usage error about moving a patch relative to itself, followed by `exit 1`.

**If you see something else:** an unchanged list means the position was read wrongly; `exit 0` on the second command means the self-reference check is missing.

**Result:** passed (agent). List alpha, `>2` gamma, delta, beta; then `debaser: a patch can't be moved relative to itself`, the usage text, and `exit 1`.

### Step 5 of 9: Reorder interactively (US3)

**Why this step:** plain `move` asks which patch to move and where, shows the new order after each move, and saves once at the end.

**Needs:** Step 4. This step needs your terminal (it reads answers from you).

**Do:**

1. In a terminal, run `cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/clone && /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser move`
2. Answer `4` to "Move which patch?" and `1` to "To which position?".
3. Answer `n` to "Move another patch?".
4. Run `/Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser list` in the same directory.

**What you should see:** the numbered list first; after the two answers the list with beta first and marked `>1`; after `n` the command ends; `list` shows beta, alpha, gamma, delta.

**If you see something else:** if Enter or `n` exits with an error and `list` shows the old order, the session did not save.

**Result:** passed (user ran it on a terminal and confirmed). `list` afterwards showed gamma, beta, alpha, delta: consistent with the expected move of beta to 1 plus a second move of gamma to 1 in the same session, saved once at the end.

### Step 6 of 9: The proposal refuses unfetched patches (US4)

**Why this step:** the proposal only reads what the last fetch left behind; a fork branch never fetched is named, with a hint to use `--fetch`.

**Needs:** Step 5.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/clone && D=/Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser && $D add mine "Mine" && $D add "file:///Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/fork.git#branch=clash" "Clash" && $D move --propose </dev/null; echo "exit $?"
```

**What you should see:** two `added ...` lines, then a refusal naming the clash patch (and possibly upstream) as not fetched, mentioning `--fetch`, and `exit 1`.

**If you see something else:** a proposal instead of a refusal means it used refs it should not have; a refusal of the `file://` URL means local fork URLs are not accepted as sources.

**Result:** passed (agent). `debaser: no fetched commit for file:///…/fork.git:clash`, `fetch first: debaser move --propose --fetch`, `exit 1`. Upstream was already fetched by the clone, so only the fork branch was named.

### Step 7 of 9: Fetch, propose, and check nothing changed (US4)

**Why this step:** with `--fetch` the proposal sees all patches. `mine` and `clash` change the same line in either order, so the own branch `mine` should move after `clash`. Off a terminal it only prints; a second run must leave every ref unchanged.

**Needs:** Step 6.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/clone && D=/Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser && $D move --propose --fetch </dev/null; git for-each-ref > ../refs-before && $D move --propose </dev/null; echo "exit $?"; git for-each-ref | diff ../refs-before - && echo "refs unchanged"
```

**What you should see:** twice a block starting `merge order proposal (merge conflicts only; checks were not run)` with CURRENT and PROPOSED columns, `mine` moved after the clash patch with a reason naming `app.txt` and that `mine` is your branch, the pair listed under `conflicts no order avoids`, a conflicts line, and `run debaser move --propose --yes to apply it`; then `exit 0` and `refs unchanged`.

**If you see something else:** a diff before `refs unchanged` means the proposal wrote refs; `mine` staying before the clash patch means rule 2 did not apply.

**Result:** passed (agent). Both runs printed the proposal: `#5 mine after #6 file:///…/fork.git:clash: both change app.txt; mine is your branch`, the pair under `conflicts no order avoids`, `conflicts: current order 1, proposed order 1`, `run debaser move --propose --yes to apply it`; `exit 0`, `refs unchanged`. Cosmetic: with a long fork URL the side-by-side columns are about 170 characters wide.

### Step 8 of 9: Apply the proposal (US4)

**Why this step:** `--yes` applies the proposal without a terminal; debaser saves the order and points at the next build instead of starting one.

**Needs:** Step 7.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/specs/003-patch-ordering/.walkthrough/sandbox/clone && /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering/dist/debaser move --propose --yes </dev/null
```

**What you should see:** the proposal, then the numbered list with the clash patch before `mine` (moved rows marked with `>`), and the last line `next: debaser build`.

**If you see something else:** no `next: debaser build` line means the order was not applied.

**Result:** passed (agent). List with `>5` clash and `>6` mine, last line `next: debaser build`.

### Step 9 of 9: Run the feature's automated tests (US5)

**Why this step:** the stopped-run refusal, the held-lock refusal and the "merge order changed" build note need a real build that stops; the integration tests set that up on throwaway repositories.

**Needs:** Step 1.

**Run:**

```
cd /Users/rhuss/Development/context-engineering/debaser/.claude/worktrees/003-patch-ordering && bun test src/core/order.test.ts src/report/order-note.test.ts tests/integration/order.test.ts
```

**What you should see:** every test passes (`0 fail`).

**If you see something else:** a failing test names the behavior that broke; a missing file means a test was renamed.

**Result:** passed (agent). `40 pass, 0 fail` across 3 files. Correction: the expectation mentioned one skipped timing test, but that test is not in these files, so no skip appears.

## Not covered here

- Refusing reordering during a stopped run, the held-lock refusal, and the build's "merge order changed" note are only exercised through the automated tests in step 9: triggering them by hand needs a project with a recipe whose build stops at a merge conflict.
- `--fetch` for GitHub PRs needs an authenticated `gh` and a real repository; the sandbox uses own branches and a local fork instead.

## Coverage

- US1 (insert at a place): step 3.
- US2 (command-line move): step 4.
- US3 (interactive move): step 5.
- US4 (proposal): steps 6 to 8.
- US5 (safety and the build note): step 9, through the automated tests only (see above).

## Results

9 steps: 9 passed, 0 failed, 0 skipped. Insert with `add --after`, command-line and interactive `move`, the self-move refusal, the unfetched refusal, `move --propose` with `--fetch` and `--yes`, and the no-refs-changed guarantee all behaved as specified on a sandbox project. The stopped-run guard and the build note were confirmed through the automated tests. One cosmetic finding: the proposal's side-by-side columns get very wide with long source names such as file URLs.
