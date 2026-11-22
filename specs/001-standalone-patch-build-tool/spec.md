# Feature Specification: debaser v1, a standalone tool for patched builds

**Feature Branch**: `001-standalone-patch-build-tool`

**Created**: 2026-11-21

**Status**: Draft

**Input**: The author's design brainstorm for a standalone patch build tool (not published; its 2026-11-21 revisit supersedes earlier decisions). debaser keeps a patched build of someone else's GitHub project: upstream plus an ordered patch list of upstream PRs, fork PRs, fork branches and own branches. Every rebuild fetches, rebases own branches, merges in order, verifies with project-wide and per-patch checks, and produces a runnable artifact. Conflicts and failing checks go to an AI agent harness first, whose results debaser verifies, and to the user only when the agent can't fix them. The plugin model (recipes, failure parsers, harness adapters, acceptance checks) is designed first, and the behavior pinned by the existing custom-build tool's integration suite is carried over or dropped on purpose.

## Background

corgi's `scripts/custom_build` (tals/corgi#117) already does this job for one project. debaser is a rewrite of that tool as an independent project with no corgi code or names in its core. tals/corgi#117 is frozen: new behavior goes into debaser only. The scenarios in the existing tool's integration suite (`tests/custom_build.test.ts`; each `test(...)` case counts as one scenario, about 130 to 140 depending on the copy, counted from the frozen tals/corgi#117 head when the contract is written) are debaser's **behavior contract**.

Two pilot projects prove generality:

- **tals/corgi** (Bun/TypeScript plus Zig): the tool's origin.
- **rtk-ai/rtk** (Rust, cargo; very active, thousands of PRs): patch set of an upstream PR (#2569), a likely-to-merge upstream PR (#4891) and two own branches, chosen to cover every source kind and to produce real conflicts.

## Clarifications

### Session 2026-11-21

- Q: Which file formats do the recipe and the patch list use? → A: TOML for recipes (hand-written, comments allowed), JSON for the patch list (written by debaser's commands, still hand-editable).
- Q: Where does the per-person patch list (with run state, reports and logs) live by default? → A: In a `debaser/` directory inside the checkout's shared git directory, outside the working tree and shared by all worktrees of the checkout.
- Q: How does debaser decide a patch is the user's own (may be rebased and pushed) versus someone else's? → A: Local branches, plus PRs and branches whose head repository is the repository `origin` pushes to; everything else is someone else's.
- Q: How is an acceptance check's expected output matched? → A: A regular expression searched in the check's combined stdout and stderr.
- Q: What happens if a second debaser command starts while one is running in the same checkout? → A: It refuses with exit code 1, naming the running process; a lock left by a process that no longer exists is taken over.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rebuild a patched build of any project (Priority: P1)

A power user runs a tool from upstream plus a few of their own PRs and a few of other people's. They point debaser at a checkout of that project, list the patches once, and run `rebuild` whenever upstream moves. debaser fetches upstream and every patch, resets an integration branch to upstream, merges the patches in order, runs the project's checks, builds the artifact, keeps the previous build as a fallback, and writes a report.

**Why this priority**: This is the core value. Without it nothing else matters, and it is the first slice that replaces the corgi script for a real project.

**Independent Test**: In a temporary repository pair (an "upstream" with PRs and a fork), configure a recipe with simple checks and an artifact, add one patch of each source kind, run `rebuild`, and verify the integration branch holds upstream plus each patch as a titled merge, the checks ran, the artifact exists, and a report was written.

**Acceptance Scenarios**:

1. **Given** a checkout with a recipe and a patch list holding an own branch, an upstream PR, a fork PR and a fork branch, **When** the user runs `rebuild`, **Then** the integration branch equals upstream plus one merge per patch in list order, each titled `Merge <source>: <description>`, every recipe check passes, and the artifact is built and installed at the recipe's install path.
2. **Given** a successful earlier build, **When** a new rebuild succeeds, **Then** the earlier artifact is kept as the previous build, and `rollback` returns the integration branch and artifact to it (reinstalling dependencies when the recipe has an install step).
3. **Given** a dirty checkout or a run that is already stopped, **When** the user runs `rebuild`, **Then** debaser refuses, names the reason and what to run instead, and changes nothing.
4. **Given** a patch that can't be fetched, **When** the user runs `rebuild`, **Then** the run stops before anything is reset.
5. **Given** a patch whose PR was merged upstream or whose commits are already contained in upstream, **When** the user runs `rebuild`, **Then** that patch is skipped and reported as merged; a closed but unmerged PR is still merged with a warning.
6. **Given** a recipe with an after-build command, **When** a run succeeds, **Then** the command runs; it never runs after a stopped run.
7. **Given** the user runs `add` with an upstream PR number, `owner/repo#N`, a PR URL, `owner/repo:branch`, a tree URL, `<git url>#branch=<name>` or a local branch name, **When** the patch list is saved, **Then** each entry records its kind, the date it was added and (for PRs) the PR title, duplicates are refused, the integration branch and its backup are refused as patches, and fork URLs carrying credentials are refused.
8. **Given** a patch the user no longer wants, **When** they run `remove` with a reason, **Then** the patch is retired with that reason and date and no longer merged; `list` shows live and retired patches.
9. **Given** a project with no recipe of its own and no built-in project recipe, **When** the user runs `rebuild`, **Then** debaser detects the matching generic recipe from the project's files, or stops with a message naming the recipes it can use when none matches.

---

### User Story 2 - Stop, blame and recover (Priority: P1)

When a patch conflicts or a check fails, the user needs to know whose fault it is and how to get going again. debaser stops with a clear reason, offers `continue` and `rollback`, reruns a failing check once to rule out flakiness, and reruns it on plain upstream so a broken upstream is reported as such instead of blamed on a patch.

**Why this priority**: The anti-goal is "no more babysitting than today". Stops and recovery are what make unattended rebuilds safe; they belong with the MVP.

**Independent Test**: In the temporary repository pair, create a conflicting patch and a patch that breaks a check, rebuild without a harness, and verify the stop reasons, exit codes, `continue` after a manual fix, and `rollback`.

**Acceptance Scenarios**:

1. **Given** two patches that conflict and no harness, **When** the user runs `rebuild`, **Then** debaser stops with exit code 2 naming the conflicted files; after the user resolves and runs `continue`, the run finishes, and the next rebuild replays the same resolution automatically.
2. **Given** a check that fails only on the patched tree, **When** it fails twice, **Then** the run stops with exit code 3 naming the step, the patches behind it, and a ready-to-run prompt for fixing it with an agent.
3. **Given** a check that also fails on plain upstream, **When** it fails, **Then** the run stops with exit code 4, says upstream is broken, and blames no patch.
4. **Given** a check that fails once and passes on rerun, **When** the run finishes, **Then** the check is reported as flaky, never fixed or blamed.
5. **Given** a stopped run, **When** the user runs `rollback`, **Then** the checkout returns to the last good build (or to the branch the run started on for a first run), keeping uncommitted edits the user made on another branch; a rollback refused because of uncommitted changes leaves the stopped run continuable.
6. **Given** a stopped run, **When** the user runs another `rebuild`, **Then** debaser refuses, saying where the run stopped and what to run.
7. **Given** `continue` after an interrupted step, **When** it commits work, **Then** it commits only tracked changes, and it refuses if the integration branch is no longer checked out.
8. **Given** the integration branch is checked out in another worktree, **When** the user runs `rebuild`, **Then** debaser refuses before changing anything.

---

### User Story 3 - Verified agent repair and handoffs (Priority: P2)

The user configures an AI agent (claude, codex, pi, opencode, or any command) as the harness. When a merge conflicts or a check fails on the patched tree only, debaser asks the agent to fix it, then checks the result itself before accepting it. Every agent change stays visible, separate and revertable. When a patch itself needs work, debaser writes a handoff prompt for that patch's own branch.

**Why this priority**: Agent repair is what turns rebuilds from "stops every other day" into "runs unattended". It depends on Stories 1 and 2.

**Independent Test**: Use a scripted fake harness command that resolves (or mis-resolves) conflicts and fixes (or breaks) files, and verify acceptance, rejection, retry limits, commits, trailers and handoff files.

**Acceptance Scenarios**:

1. **Given** a conflict and a harness, **When** the harness leaves no conflict markers, touches only the conflicted files and commits nothing, **Then** debaser commits the merge with a trailer marking it as harness-resolved.
2. **Given** a harness resolution with leftover markers, edits outside the conflicted files, its own commits, or a timeout, **When** debaser checks it, **Then** the attempt is undone and retried from the same state until the attempt limit, after which the run stops with exit code 5.
3. **Given** a check that fails on the patched tree but passes on plain upstream, **When** the harness fixes it, **Then** the fix becomes its own commit marked as an agent fix, every check reruns from the first, and the next rebuild starts without that fix (fixes are never carried forward).
4. **Given** a check that fails on plain upstream too, **When** the run stops, **Then** the harness is never called.
5. **Given** a harness command that is not executable, **When** a conflict or failing check needs it, **Then** debaser warns once and stops as it would without a harness (exit code 2 or 3). **Given** a harness that runs but exits non-zero without an acceptable result (for example an expired login), **When** its attempts are used up, **Then** the run stops with exit code 5 naming the harness's exit code and last output line, and `continue` asks the harness again. **SUPERSEDED**
5. **Given** a harness command that is not executable, **When** a conflict or failing check needs it, **Then** debaser warns once and stops as it would without a harness (exit code 2 or 3). **Given** a harness that runs but exits non-zero without an acceptable result (for example an expired login), **When** debaser judges that call, **Then** it does not retry it (the next call would fail the same way), stops at once with exit code 5 naming the harness's exit code and last output line, and `continue` asks the harness again.
6. **Given** a harness call that times out, **When** debaser ends it, **Then** every process the harness started ends with it.
7. **Given** a resolution recorded in an earlier run, **When** the same conflict comes up, **Then** it is replayed before any harness is called.
8. **Given** a patch that conflicts with upstream alone, or needed an agent fix while failing alone on upstream, **When** the run ends, **Then** a handoff prompt is written for that patch (rebase needed, or a fix touching its files); patches that only clash with each other get a note naming each other and no rebase handoff.
9. **Given** the claude, codex, pi or opencode adapter, **When** the harness runs, **Then** the log shows readable text, the raw event stream is kept, and token usage is recorded; the plain adapter logs text and records tokens as unknown.
10. **Given** a recipe or project override, **When** a harness prompt is built, **Then** debaser uses its own shipped prompt templates (with the project name, no corgi wording) unless the recipe or local override replaces them, and the conflict prompt for a PR carries its link and description.
11. **Given** a configuration naming different harnesses per task (conflict, failing check, failing acceptance check, rebase), **When** each task needs an agent, **Then** the harness for that task is used, falling back to the default harness.

---

### User Story 4 - Per-patch acceptance checks (Priority: P2)

Project-wide checks say the combined build works. They don't say each patch still does what it is for. The user attaches an acceptance check to a patch: a command run against the built artifact plus the expected outcome. A failing acceptance check blames only that patch and gives the agent a narrow target.

**Why this priority**: The revisit defines a successful build as "every live patch merged and all checks passing, project-wide and per patch". It needs the artifact from Story 1.

**Independent Test**: Give one patch an acceptance check that passes, one that fails, and leave one without; rebuild and verify the outcomes, the blame, and the "unverified" marking.

**Acceptance Scenarios**:

1. **Given** a patch with an acceptance check (command, expected exit code, optional expected output pattern), **When** the build succeeds, **Then** debaser runs the check against the artifact and records pass or fail for that patch.
2. **Given** an acceptance check that fails, **When** the run evaluates it, **Then** only that patch is blamed; with a harness, the agent gets a fix task scoped to that patch, verified like any fix; without one, the run stops with a distinct exit code and a handoff for that patch.
3. **Given** a patch without an acceptance check, **When** the run reports results, **Then** that patch is listed as "unverified", and the run is not failed for it.
4. **Given** an acceptance check that fails once and passes on rerun, **When** the run finishes, **Then** it is reported as flaky.

---

### User Story 5 - Keep own branches rebased (Priority: P2)

A contributor with several open PRs wants them kept current. debaser rebases the user's own branches (and the head branches of the user's own PRs) onto upstream in throwaway worktrees, checks each one alone, keeps a backup, and pushes with a lease when asked. Other people's branches are never rewritten.

**Why this priority**: It is part of today's behavior and of every rebuild; it needs Stories 1 to 3 underneath.

**Independent Test**: In the temporary repository pair, put own branches behind upstream (one clean, one conflicting, one failing its checks alone), run `rebase` and `rebuild`, and verify which branches moved, backups, handoffs and lease-protected pushes.

**Acceptance Scenarios**:

1. **Given** own branches behind upstream, **When** the user runs `rebuild` with rebase mode "all", **Then** each is rebased in its own throwaway worktree, checked alone, and the rebased tips are merged; with mode "conflicting" only conflicting branches are rebased; with "off" none are. A command-line option overrides the configured mode.
2. **Given** a rebased branch whose checks fail alone, **When** no harness can fix it, **Then** it keeps its old tip and gets a handoff; with a harness, the fix becomes a separate commit for review before pushing.
3. **Given** a rebase conflict inside `rebuild` that can't be resolved, **When** the run continues, **Then** the branch keeps its old tip and the run goes on to merge it; the standalone `rebase` command instead stops (exit code 2) and offers `continue`, `continue --skip-branch`, and `rollback`.
4. **Given** rebased branches, **When** the user confirms the push prompt or passes the push option, **Then** they are pushed to the fork with a lease; a remote copy that moved meanwhile is kept and reported, not overwritten.
5. **Given** branches or PRs that belong to someone else, **When** any rebase runs, **Then** they are never rebased or pushed, and they keep their rebase handoffs.
6. **Given** an own branch that is checked out elsewhere, diverged from its pushed copy, or already contained upstream, **When** a rebase runs, **Then** it is left alone and reported; with the in-worktree option, a checked-out clean branch is rebased in its own worktree, and every change the user made there during the run is preserved.
7. **Given** an own branch that is behind its pushed copy, **When** a rebuild runs, **Then** the pushed copy is used; a diverged one uses the local copy with a warning; one known only from a stale remote copy stops the run.
8. **Given** a rebuild with the push option, **When** it succeeds, **Then** the integration branch is pushed to the user's fork; a plain rebuild never pushes, and pushing the integration branch to upstream is refused.

---

### User Story 6 - Status at a glance (Priority: P3)

Before or between rebuilds the user asks "what needs patching, how far did upstream move, what are the PRs doing?" `status` answers on one screen without changing anything.

**Why this priority**: One of the two anti-goals is "making the current state harder to understand". It is read-only and builds on everything above.

**Independent Test**: With a recorded earlier build and a few upstream commits since, run `status` and verify each patch row and the summary against a known repository state, and that nothing in the repository changed.

**Acceptance Scenarios**:

1. **Given** a patch list and a fetched upstream, **When** the user runs `status`, **Then** each patch shows its PR state (open, merged, closed, or not a PR), whether it still merges onto the latest upstream, what `rebase` would do for it, and its last check and acceptance results.
2. **Given** an earlier build, **When** the user runs `status`, **Then** it shows how many upstream commits landed since that build and since each patch's base.
3. **Given** a branch force-pushed by hand, **When** status compares it with its pushed copy, **Then** it reads the remote state git records and does not call it diverged.
4. **Given** `status` with the machine-readable option, **When** it runs, **Then** it prints the same facts as structured data.

---

### User Story 7 - Recipes that projects can share and extend (Priority: P3)

A project owner wants debaser to know their project's checks without every user writing them. Recipes describe a project's steps, failure parsers, install triggers, artifact, after-build command and prompt overrides. They come in layers: generic recipes for an ecosystem, project recipes shipped with debaser, a recipe committed in the project's own repository, and local overrides beside the user's patch list. Each layer can extend the one below.

**Why this priority**: The plugin model is designed first, but the first users can work with built-in recipes; owner-maintained recipes and overrides make the tool reach beyond the pilots.

**Independent Test**: Build the effective recipe for a temporary project with each layer present and absent, and verify the merge order, the precedence, the trust prompt for a project-repo recipe, and that the result is shown by a command.

**Acceptance Scenarios**:

1. **Given** a project whose upstream is `tals/corgi` or `rtk-ai/rtk`, **When** debaser resolves its recipe, **Then** the matching built-in project recipe is used, extending `bun-ts` or `rust-cargo` respectively.
2. **Given** a recipe committed in the project's repository at debaser's fixed path, **When** debaser first sees it (or sees it changed), **Then** it shows the commands it would run and asks the user to trust it; a headless run refuses an untrusted recipe unless an explicit trust option is given; once trusted, it wins over the built-in project recipe.
3. **Given** a local override beside the patch list, **When** the recipe resolves, **Then** the override's values win over every other layer.
4. **Given** a recipe that names a step without a failure parser, **When** the step fails, **Then** the run still works, without narrowed retries or implicated-patch detection. **SUPERSEDED**
4. **Given** a recipe that names a step without a failure parser, **When** the step fails, **Then** the run still works: the flaky rerun runs the step in full instead of narrowing it, and implicated patches come from the file paths named in the log.
5. **Given** any layered recipe, **When** the user asks for the effective recipe, **Then** debaser prints the resolved steps, artifact and parsers and which layer each value came from.
6. **Given** a build step, **When** it runs, **Then** it receives the patch list, the fork URL and the integration commit through environment variables, and a manifest file with the same data is written, so a project can stamp its build without debaser reaching into it.

---

### User Story 8 - Live view, timings and headless runs (Priority: P3)

On a terminal, the user watches a live view: a timeline against the previous run, estimates from recorded timings, a checklist, harness tokens, retries and a final card pointing at the report. In CI or cron, the same run prints plain output and a machine-readable result with documented exit codes.

**Why this priority**: Today's tool has this; it is UX polish over the core and must not change outcomes.

**Independent Test**: Run a rebuild with output piped and with a pseudo-terminal, and verify the plain output is identical with and without the live view's event sink, the card, the timings file, and the machine-readable result.

**Acceptance Scenarios**:

1. **Given** output to a terminal, **When** a command with a live view runs, **Then** it shows stages, items, estimates from history, harness activity and tokens, warnings, and ends in a summary card that points at the report; with the verbose option the view is pinned over the full log.
2. **Given** output piped, **When** the same command runs, **Then** it prints plain output identical to a run without the live view.
3. **Given** an error before or during a live run, **When** the command ends, **Then** the view ends with the error on its card.
4. **Given** a run that finishes or stops, **When** timings are saved, **Then** the next run has history for estimates; a timings file that can't be written is a warning and the run keeps its outcome.
5. **Given** a headless run with the machine-readable option, **When** it ends, **Then** it prints a structured result (outcome, exit code, per-patch results, report path) and exits with the documented code.
6. **Given** reports from many runs, **When** a new one is written, **Then** a "latest" pointer follows it, and only the ten newest run reports and ten newest rollback logs are kept.

---

### Edge Cases

- A patch named like a branch debaser resets (the integration branch or its backup): refused on `add` and at `rebuild`.
- The checkout's upstream remote is missing, or `origin` fetches from upstream but pushes to the fork, or has several push URLs: tips, leases and pushes use the URL origin pushes to; remote URLs compare by repository however they are spelled.
- No `origin` remote at all: nothing is rebased, and worktrees an interrupted run left behind are removed.
- `gh` is missing or not authenticated: PR sources can't be resolved; own PR head branches are not rebased; the stop or warning says so.
- A git version too old for the operations debaser needs: refused at start with the minimum version.
- A reset that fails midway: the run state is discarded and the integration branch is restored to where it was before the run.
- A step that exceeds its timeout: treated as a failing step (rerun once, then rerun on plain upstream).
- Untracked files in the checkout: do not make it dirty; only staged or unstaged changes to tracked files do.
- Ctrl-C during a run: debaser stops at once with exit code 130 and leaves a state `continue` or `rollback` can handle.
- The harness leaves temporary build files behind: they are never committed with a fix.
- A branch named by two patches: rebased once, and both merge its new tip.
- A branch moved, checked out or switched while it is being rebased: it stays where the user left it.
- A stopped rebase run whose worktree was deleted: it can still be skipped or rolled back.
- A patch list or recipe written by a newer debaser, or with an invalid harness section: refused with a message.
- Install step: runs when the recipe's install-trigger files changed or when nothing is installed yet.
- A harness that keeps making fixes that break each other: the run stops with exit code 5 after a bounded number of fixes.
- A second debaser command started while one runs in the same checkout: refused with exit code 1 naming the running process; a lock from a dead process is taken over.

## Requirements *(mandatory)*

### Functional Requirements

**Patch list and sources**

- **FR-001**: debaser MUST keep a per-person patch list (JSON), separate from the shareable recipe, stored by default with run state, reports and logs in a `debaser/` directory inside the checkout's shared git directory (outside the working tree, shared by all worktrees), in a location the user can override with `--dir` and the `DEBASER_DIR` environment variable (the option winning).
- **FR-001a**: The first `add` MUST create the patch list: the upstream repository comes from the `upstream` remote unless `--upstream owner/repo` is given, the upstream branch is that remote's default branch, and the integration branch defaults to `debaser`. Without an `upstream` remote and without the option, `add` MUST refuse and say how to set one.
- **FR-001b**: Only one mutating debaser command may run per checkout at a time; a second one MUST refuse with exit code 1 naming the running process, and a lock left by a process that no longer exists MUST be taken over.
- **FR-002**: The patch list MUST accept these source kinds: upstream PR, PR on another GitHub repository, fork branch, and own local branch, written as PR numbers, `owner/repo#N`, PR URLs, `owner/repo:branch`, tree URLs, `<git url>#branch=<name>` or a branch name.
- **FR-003**: debaser MUST provide `add`, `remove` (retire with a reason) and `list` commands, recording each patch's kind, added date, optional description and (for PRs) title, and refusing duplicates, the integration branch and its backup, and URLs that carry credentials.
- **FR-004**: debaser MUST access GitHub only through the `gh` command for PR metadata; source kinds MUST sit behind an interface so other forges can be added later.

**Rebuild**

- **FR-005**: `rebuild` MUST fetch upstream and every patch into debaser's own ref namespace before resetting anything, and stop without changes if any fetch fails.
- **FR-006**: `rebuild` MUST reset the integration branch to upstream, merge live patches in list order with recorded conflict resolutions replayed, and title merges `Merge <source>: <description>`.
- **FR-007**: `rebuild` MUST skip patches merged upstream or already contained in upstream, report them, and merge closed-but-unmerged PRs with a warning.
- **FR-008**: `rebuild` MUST run the recipe's steps in order on the merged tree, run the install step only when its trigger files changed or nothing is installed yet, build the artifact, and keep the previous artifact as a fallback.
- **FR-008a**: When the recipe names an artifact, debaser MUST copy the built artifact to the recipe's fixed install path inside the checkout (for example `dist/corgi-custom`) only after a fully successful run, and keep the build it replaces as `<path>.prev`; build outputs overwritten by later baseline or rebase checks never change the installed copy, and `rollback` restores from these copies.
- **FR-009**: `rebuild` MUST refuse to start on a dirty checkout (staged or unstaged changes to tracked files; untracked files don't count), while a run is stopped, or when the integration branch is checked out in another worktree.
- **FR-010**: The after-build command MUST run only after a fully successful run.
- **FR-011**: With the push option, `rebuild` MUST push the integration branch to the user's fork and MUST refuse to push it to upstream; without the option it MUST never push.

**Checks, blame and recovery**

- **FR-012**: A failing step MUST rerun once; passing on rerun MUST be reported as flaky. A second failure MUST rerun the step on plain upstream; failing there too MUST stop with exit code 4 and blame no patch.
- **FR-013**: debaser MUST use and document exactly these exit codes:
  - 0: success.
  - 1: usage or precondition error (dirty checkout, a run already stopped or running, git too old, fetch failure, an untrusted project recipe in a headless run, an own branch known only from a stale remote copy), and a run that finished but whose push of a rebased branch was refused.
  - 2: stopped at an unresolved merge conflict, or at a rebase conflict in the `rebase` command.
  - 3: stopped at a step that fails only on the patched tree.
  - 4: the step fails on plain upstream too (upstream is broken).
  - 5: the harness ran out of attempts, the total fix bound was reached, or the harness kept exiting non-zero without an acceptable result.
  - 6: stopped at a failing acceptance check with no accepted fix.
  - 129, 130, 143: ended by SIGHUP, SIGINT (Ctrl-C) or SIGTERM, leaving a state `continue` or `rollback` can handle.
  A harness command that is not executable is a warning, and the run then behaves as without a harness.
- **FR-014**: A stop MUST name the step or files, the implicated patches, the log, and a ready-to-run agent prompt, and MUST offer `continue` and `rollback`. **SUPERSEDED by FR-055**
- **FR-055**: A stop MUST name the step or files, the implicated patches, the log, and a ready-to-run agent prompt. It MUST offer `continue` and `rollback`, except a stop because the step fails on plain upstream too (exit code 4), which MUST offer only `rollback`: continuing the same run can't repair upstream.
- **FR-015**: `continue` MUST resume a stopped run from where it stopped, commit only tracked changes, refuse when the integration branch is no longer checked out, and keep one set of handoffs per run. **SUPERSEDED by FR-056**
- **FR-056**: `continue` MUST resume a stopped run from where it stopped, refuse when the integration branch is no longer checked out, and keep one set of handoffs per run. After a stop it MUST commit the user's fix as found, including new files; after a step that was interrupted rather than stopped, it MUST commit only changes to tracked files.
- **FR-016**: `rollback` MUST, with a stopped run, return the checkout and artifact to the build that was current when the run started (or to the branch the run started on, for a first run); with no stopped run, return to the previous build; with neither, refuse and say there is nothing to roll back. It MUST reinstall dependencies when the recipe has an install step, and keep the user's uncommitted edits on other branches.

**Agent harness**

- **FR-017**: debaser MUST support harness adapters for claude, codex, pi, opencode and a plain adapter for any command; the user writes the command and the adapter only adds the flags that turn on its event stream.
- **FR-018**: Each adapter MUST turn its agent's event stream into readable log text, activity events and token counts; the raw stream MUST be kept; the plain adapter records tokens as unknown.
- **FR-019**: debaser MUST accept a conflict resolution only when no conflict markers remain, only the conflicted files changed, and nothing was committed; accepted resolutions MUST be committed with a harness trailer.
- **FR-020**: debaser MUST call the harness for a failing step only when that step passes on plain upstream; an accepted fix MUST be its own agent-marked commit, after which every step reruns from the first; fixes made on the integration branch MUST never be carried into the next rebuild (fixes on own branches follow FR-031a).
- **FR-021**: Each harness call MUST have a timeout (default 900 seconds) that ends the harness's whole process group, and each problem a limit of attempts (default 3); a run MUST also stop with exit code 5 once the harness has made attempts × number of steps fixes and a step still fails, where acceptance-check fixes count toward this bound and each acceptance check counts as one step. All three values MUST be configurable in the patch list's harness section.
- **FR-022**: A rejected attempt MUST be undone to the state before it and retried from there; files that recorded resolutions (rerere) resolved MUST stay resolved and staged across attempts.
- **FR-023**: The harness MUST be configurable per task (conflict, failing check, failing acceptance check, rebase), defaulting to one harness for all.
- **FR-024**: Prompts MUST come from templates shipped with debaser using the project name, overridable by recipe or local override; the conflict prompt for a PR MUST carry its link and description.
- **FR-025**: debaser MUST NOT translate tool permissions between agents; its documentation MUST show a safe example command per agent.

**Handoffs**

- **FR-026**: After a run, debaser MUST write one handoff prompt per affected patch: "needs a rebase" for a patch conflicting with upstream alone, "build drift" for a patch that needed an agent fix while failing alone, and "acceptance" for a failing acceptance check; patches that only clash with each other MUST get a note naming each other instead. **SUPERSEDED by FR-057**
- **FR-057**: After a run, debaser MUST write one handoff prompt per affected patch: "needs a rebase" for a patch conflicting with upstream alone, "build drift" for a patch that needed an agent fix while failing alone, "build clash" (naming the other patches) for patches that needed an agent fix while failing only together, and "acceptance" for a failing acceptance check. Patches whose merges only conflict with each other MUST get a note naming each other in the report instead of a handoff.
- **FR-027**: Attribution MUST run after an accepted agent fix and at a step stop, to decide which handoffs to write. Candidate patches are the merged patches whose changed files appear among the failure's implicated paths (from the failure parser, or file paths named in the log outside lines that hold nothing but a path). Each candidate's failing step MUST be run with that patch alone on upstream, reporting which patch runs and how many remain. With no candidate, attribution runs nothing and hands off nothing. This is not the multi-patch bisection deferred past v1. **SUPERSEDED by FR-058**
- **FR-058**: Attribution MUST run after an accepted agent fix and at a step stop, to decide which handoffs to write. Candidate patches are the merged patches whose changed files appear among the failure's implicated paths (from the failure parser, plus file paths named in the log outside lines that hold nothing but a path) or among the files the agent's fix changed. Each candidate's failing step MUST be run with that patch alone on upstream, reporting which patch runs and how many remain. With no candidate, attribution runs nothing and hands off nothing. This is not the multi-patch bisection deferred past v1.

**Acceptance checks**

- **FR-028**: Each patch MAY carry an acceptance check in its patch list entry: a command, an expected exit code (default 0), and an optional regular expression that must match somewhere in the check's combined stdout and stderr, run after all project-wide checks pass, from the root of the integration tree, with `DEBASER_ARTIFACT` set to the build output path (the artifact is installed only after acceptance checks pass; unset when the recipe has no artifact, in which case the check runs against the tree). Each check has a default timeout of 300 seconds, overridable per check. All acceptance checks run before results are reported.
- **FR-029**: A failing acceptance check MUST blame only its patch, rerun once for flakiness, go to the harness as a fix task scoped to that patch when one is configured, and otherwise stop with exit code 6 and a handoff. An accepted acceptance fix MUST rerun every project-wide step, rebuild the artifact and rerun the acceptance checks; a harness that runs out of attempts MUST stop the run with exit code 5. A build that fails an acceptance check MUST NOT replace the last good build.
- **FR-030**: Patches without an acceptance check MUST be reported as "unverified" without failing the run; a patch skipped as merged or contained MUST NOT run its acceptance check and is reported as "skipped".

**Own-branch rebasing**

- **FR-031**: debaser MUST rebase own branches and the head branches of the user's own PRs onto upstream in throwaway worktrees, check each alone, keep a backup of each old tip, and merge the rebased tips in `rebuild`; rebase mode (all, conflicting, off) MUST come from the patch list and be overridable per run.
- **FR-031a**: A rebased own branch whose checks fail alone MUST go to the rebase-task harness when one is configured; an accepted fix MUST be a separate agent-marked commit on the rebased branch, shown for review before any push, and it stays on that branch. Without a harness, or when the harness runs out of attempts, the branch MUST keep its old tip and get a rebase-checks handoff. For an own branch, debaser MUST use the pushed copy when the local one is behind it, use the local copy with a warning when they diverged, and stop the run (exit code 1) when the branch is known only from a stale remote copy.
- **FR-032**: A patch is the user's own when it is a local branch, or a PR or branch whose head repository is the repository `origin` pushes to; debaser MUST never rebase or push any other patch.
- **FR-033**: Rebased branches MUST be pushed to the fork only after confirmation or with the push option, always with a lease; a remote copy that moved MUST be kept and reported; a branch not pushed yet MUST be offered again on later runs.
- **FR-034**: Branches checked out elsewhere, diverged from their pushed copy, already contained upstream, or moved during the run MUST be left alone and reported; with the in-worktree option, a clean checked-out branch MUST be rebased in its own worktree, preserving any commit or edit the user made there during the run.
- **FR-035**: The standalone `rebase` command MUST stop at a conflict it can't resolve (exit code 2) and offer `continue`, `continue --skip-branch` and `rollback`; inside `rebuild` an unresolved rebase conflict MUST keep the old tip and the run MUST go on.
- **FR-035a**: A conflict during a rebase MUST go to the rebase-task harness one replayed commit at a time, accepted under the same rules as a merge conflict (no markers left, only the conflicted files changed, no commits of its own), after which the rebase goes on; a rejected resolution is retried from that commit, keeping git's choice of commits.

**Status**

- **FR-036**: `status` MUST NOT run `git fetch` unless given `--fetch` (it MAY query `gh` for live PR state), MUST NOT take the run lock, and MUST, without changing anything, show per patch: PR state, whether it merges onto the latest fetched upstream, what `rebase` would do, and the last check and acceptance results; and overall: upstream commits since the last build.
- **FR-037**: `status` MUST read remote branch state from git's own records, so a branch force-pushed by hand is not reported as diverged.

**Recipes and plugins**

- **FR-038**: A recipe MUST be a declarative TOML file and hold: named steps (any number, in order, each a command with an optional timeout and failure parser; a step that times out counts as failing), which step is the install step and its trigger files, the build output path and the install path of the artifact (both optional; some projects only need the branch), after-build command, and prompt overrides.
- **FR-039**: Recipes MUST resolve in four layers chained in this fixed order, each extending the one below: a generic recipe shipped with debaser, a project recipe shipped with debaser matched by upstream repository, a recipe committed in the project's repository at a fixed path, and local overrides beside the patch list. Absent layers are skipped; a present layer never replaces a lower one, it extends it.
- **FR-039a**: Only the lowest non-generic layer present MAY use an `extends` key, and only to name a generic recipe. Steps MUST merge by name: a step with an inherited name replaces that step in place, a new step is placed with `before` or `after` naming an existing step (appended at the end otherwise), and `steps.replace = true` replaces the whole inherited list. Every other value set in a higher layer MUST override the lower one.
- **FR-039b**: The generic recipe MUST be chosen in this order: a `recipe` field in the patch list or local override, then the `extends` key of FR-039a, then detection from project files; and when several generic recipes match, debaser MUST stop and list the candidates instead of guessing.
- **FR-040**: v1 MUST ship the generic recipes `bun-ts` and `rust-cargo` and the project recipes `tals/corgi` (native-only build before unit tests, install path `dist/corgi-custom`, hot reload as after-build command) and `rtk-ai/rtk` (format check, lint with warnings as errors, tests, release build, build output `target/release/rtk`, install path `dist/rtk-custom`).
- **FR-041**: Recipes MUST ship inside the binary; debaser MUST NOT fetch recipes at runtime.
- **FR-042**: A recipe from the project's repository MUST be read from the fetched upstream tip only, never from a patch or the merged tree, so patches can't change what runs. It MUST be trusted explicitly before first use and again after its content changes, with the trusted fingerprint stored in debaser's directory; headless runs MUST refuse an untrusted one unless `--trust-recipe` is given.
- **FR-043**: Failure parsers MUST be code in debaser behind one interface that returns failed files, failed tests, implicated paths and a summary; v1 MUST ship parsers for `bun test`, `tsc`, and `cargo test`; a step without a parser MUST still work.
- **FR-044**: debaser MUST print the effective recipe with the layer each value came from.
- **FR-045**: During build steps debaser MUST set `DEBASER_PATCHES` (the live patches as JSON), `DEBASER_FORK_URL`, `DEBASER_COMMIT` (the integration commit) and `DEBASER_MANIFEST` (the path of a JSON manifest holding the same data, written in debaser's directory before the first step). **SUPERSEDED by FR-059**
- **FR-059**: For every step and check it runs (build steps, acceptance checks, and the plain-upstream, attribution and rebase checks on side trees), debaser MUST set `DEBASER_PATCHES` (the live patches as JSON), `DEBASER_FORK_URL` (without credentials), `DEBASER_COMMIT` (the integration commit) and `DEBASER_MANIFEST` (the path of a JSON manifest holding the same data, written in debaser's directory before the first step). These always describe the integration build being made, not the side tree being checked; side-tree outputs are never installed.

**Live view, reports and headless use**

- **FR-046**: On a terminal, commands that run a build or rebase MUST show a live view with stages, items, estimates from recorded timings, harness activity and tokens, retries, warnings, links to step logs, and a final card pointing at the report; when piped, output MUST be plain and identical to a run without the live view.
- **FR-047**: Every run MUST write a report; a "latest" pointer MUST follow the newest; debaser MUST keep the ten newest run reports and ten newest rollback logs.
- **FR-048**: Timings MUST be recorded per run, without waiting time for prompts; failure to save them MUST be a warning only. **SUPERSEDED by FR-060**
- **FR-060**: Timings MUST be recorded once for every run that finishes (directly, or after a stop and `continue`), without waiting time for prompts; a run abandoned with `rollback` MUST NOT be recorded, so its partial times don't skew estimates; failure to save timings MUST be a warning only.
- **FR-049**: `rebuild` and `status` MUST offer a machine-readable result.

**Independence and contract**

- **FR-050**: debaser's core MUST contain no corgi code, names or defaults; corgi specifics MUST live only in the `tals/corgi` recipe. Environment variables MUST use debaser's own prefix.
- **FR-051**: debaser MUST ship as a single self-contained executable with no runtime dependencies beyond git and `gh`; agent CLIs are optional and needed only when a harness is configured.
- **FR-052**: Every scenario in the existing tool's integration suite MUST be recorded in a behavior-contract document as carried over (with the debaser test that covers it) or dropped on purpose (with the reason).
- **FR-053**: A patch MAY be pinned to a commit with `add <source> --pin <sha>`; a pinned patch MUST be fetched and merged at exactly that commit, MUST never be rebased, and MUST be marked as pinned in `list` and `status`.
- **FR-054**: The command-line interface MUST offer the verbs `add`, `remove`, `list`, `rebuild`, `rebase`, `continue` (with `--skip-branch` for a stopped rebase), `rollback`, `status`, `recipe` (print the effective recipe, FR-044) and `trust` (trust the project-repo recipe, FR-042), and the options `--dir` (FR-001), `--upstream` (FR-001a), `--pin` (FR-053), `--fetch` (FR-036), `--push`, `--rebase <all|conflicting|off>`, `--in-worktree`, `--verbose`, `--json` (FR-049) and `--trust-recipe`, under one standalone `debaser` command.
- **FR-061**: `rebase --skip-branch` MUST behave exactly like `continue --skip-branch`.
- **FR-062**: A recipe MAY list `leftovers` globs (for example temporary build files); files matching them MUST never be committed with an agent fix.

### Key Entities

- **Patch list**: per-person, private; upstream repository and branch, integration branch name, ordered live patches, retired patches, rebase mode, harness settings, local recipe overrides location.
- **Patch**: one source (kind, location, optional pin), description, added date, optional acceptance check, ownership (own or someone else's).
- **Retired patch**: a patch with retire date and reason.
- **Recipe**: shareable, declarative; extends a generic recipe or the layer below; steps, install step and triggers, build output path, install path, after-build command, prompt overrides; origin layer.
- **Step**: name, command, optional timeout, optional failure parser.
- **Acceptance check**: command, expected exit code, optional output pattern; belongs to one patch.
- **Failure parser**: named code plugin turning a step's output into failed files, failed tests, implicated paths and a summary.
- **Harness adapter**: named agent integration (claude, codex, pi, opencode, plain) that adds streaming flags and reads text, activity and tokens.
- **Run**: one rebuild or rebase; state (running, stopped, finished, rolled back), stop reason, timings, harness calls, per-patch results, report.
- **Handoff**: per-patch prompt file with its kind (rebase, build drift, acceptance, clash note).
- **Build**: integration commit plus the installed artifact copy at the recipe's install path; current and previous (`.prev`).
- **Behavior contract**: list of the existing suite's scenarios with carried-over or dropped status and reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing integration suite's scenarios are listed in the behavior contract as carried over or dropped with a reason, and every carried-over scenario has a passing debaser test.
- **SC-002**: The two pilot projects (corgi and rtk with the four-patch set) each complete an unattended rebuild from a fresh checkout with only a patch list written by the user, producing a runnable artifact. **SUPERSEDED by SC-009**
- **SC-009**: Validated after merge, not a merge gate (procedure in `docs/pilots.md`): the two pilot projects (corgi and rtk with the four-patch set) each complete an unattended rebuild from a fresh checkout with only a patch list written by the user, producing a runnable artifact.
- **SC-003**: One `status` screen shows, for every patch, its PR state, whether it still merges, what `rebase` would do and its last check and acceptance results, plus a summary of how far upstream moved since the last build; on the rtk pilot it finishes in under 10 seconds without `--fetch`. **SUPERSEDED by SC-010**
- **SC-010**: One `status` screen shows, for every patch, its PR state, whether it still merges, what `rebase` would do and its last check and acceptance results, plus a summary of how far upstream moved since the last build.
- **SC-012**: Validated after merge, not a merge gate (procedure in `docs/pilots.md`): on the rtk pilot, `status` finishes in under 10 seconds without `--fetch`.
- **SC-004**: Zero occurrences of corgi names or defaults outside the corgi project recipe and its tests.
- **SC-005**: Installing debaser requires copying one file; the tool runs on a machine with only git and `gh` installed.
- **SC-006**: Adding support for a new agent needs one new adapter and no change elsewhere; adding a new project needs only a recipe.
- **SC-007**: No agent change reaches the integration branch without passing debaser's verification, and every agent change is a separate, identifiable commit.
- **SC-008**: For the corgi pilot, interventions (run stops that need user action, counted from run reports) over a month of daily rebuilds are no more frequent than in a two-week baseline recorded with the existing custom-build tool. **SUPERSEDED by SC-011**
- **SC-011**: Validated after merge, not a merge gate (procedure in `docs/pilots.md`): for the corgi pilot, interventions (run stops that need user action, counted from run reports) over a month of daily rebuilds are no more frequent than in a two-week baseline recorded with the existing custom-build tool.

## Assumptions

- **Open threads resolved with defaults** (the brainstorm left these open; they can be changed in clarification):
  - Recipes are TOML and the patch list is JSON (see Clarifications).
  - Acceptance checks live in the patch list entry of their patch, with output matched by regular expression.
  - A project-repo recipe is found at one fixed path under a `.debaser/` directory and trusted on first use by recording its content fingerprint.
  - The behavior contract is a scenario list document plus ported tests run against debaser.
  - Shared rerere, bisection, check caching and carry-commit mode are not in v1.
- The patch list lives in the checkout's shared git directory by default, outside the working tree, which removes today's need to keep the config directory out of `git status`; deleting the clone deletes the patch list.
- The self-copy mechanism of today's tool goes away: an installed binary does not live in the tree it resets.
- Source pinning to a commit is supported (FR-053); local `.patch` files are out of scope for v1.
- debaser is written in TypeScript on Bun and compiled to a single binary (owner constraint), and is a standalone `debaser` command, not a `git debaser` subcommand.
- Users have git and an authenticated `gh` for PR sources; projects are hosted on GitHub.
- The live view's background rendering works in the compiled single binary; if not, planning picks an alternative with the same output.
- Binary size of the compiled tool is acceptable (tens of megabytes).
- Changing corgi itself (shrinking tals/corgi#117 to identity stamping plus a docs pointer) happens in the corgi repository and is out of scope here; debaser only provides the stamping data (FR-045) and the corgi recipe.

### Out of Scope (v1)

- GitLab and other forges (sources stay behind an interface).
- Fetching recipes at runtime; translating agent permissions.
- npm publishing (Homebrew and GitHub releases only; release automation may follow later).
- Automatic migration of `.custom-build/config.json` (a one-shot import is a nice-to-have).
- `init` and `doctor` commands, generic recipes beyond `bun-ts` and `rust-cargo`, local `.patch` sources.
- A hosted service, GitHub App, web UI, merge gating, or stacked-PR authoring.
- Lifecycle hooks (before fetch, after merge, before push, on stop, on finish) and notifications beyond the live view's terminal notifications.


## Revision Notes

### 2026-11-21: Reconcile review-code deviations with the behavior contract

- Superseded: FR-014 → FR-055, FR-015 → FR-056, FR-026 → FR-057, FR-027 → FR-058, FR-045 → FR-059, FR-048 → FR-060, SC-002 → SC-009, SC-003 → SC-010 and SC-012, SC-008 → SC-011, US3/AS5, US7/AS4
- Added: FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, SC-009, SC-010, SC-011, SC-012
- Rationale: the code follows carried behavior-contract scenarios (FR-052) where the spec text disagreed; two helpful extras became requirements; the pilot criteria need real forks and weeks of use, so they are validated after merge.
