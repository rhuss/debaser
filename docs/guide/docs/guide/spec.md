# debaser Guide: guide spec

Run `2026-11-23-create`. Format Antora, rigor standard, no internal part. One pinned source: `debaser` (`https://github.com/rhuss/debaser` at `b46fcb260a1eb248a046999317cbfa98f73cb31b`). Locations below are `debaser:<path>:<lines>` in that snapshot. Research notes (local, not committed): `.guide/runs/2026-11-23-create/research.md`, claim ids `C-*`.

## Why

The why card. The start page says this, in this order (overview contract).

**Problem.** You run a tool built from someone else's GitHub project, but you want changes the project has not merged yet: your own branches, and open pull requests from other people. Every time the project moves on, you have to fetch it again, re-apply each change, fix the conflicts, rerun the tests, and rebuild the tool by hand. Sources: `debaser:specs/001-standalone-patch-build-tool/spec.md:34`, `debaser:README.md:3-8`.

**Outcome.** One command, `debaser build`, gives you a runnable build of the latest project plus your changes, applied in the order you chose, checked by the project's own checks and by a check per change, and installed in a build directory next to your clone. The build before it stays available as a fallback, and `debaser rollback` returns to it. Sources: `debaser:src/run/build.ts:50-157`, `debaser:src/run/finish.ts:38-55`, `debaser:src/run/common.ts:71-74`, `debaser:src/run/rollback.ts:141-171`.

**Components.**
- *debaser* is a command-line tool, shipped as one self-contained executable, that rebuilds a project from its latest upstream version plus an ordered list of changes (the patch list) and tells you exactly where and why a rebuild stopped. Sources: `debaser:package.json:10`, `debaser:README.md:3-14`.
- *Git* is the version control system the project lives in. debaser does every fetch, merge, and checkout through it and needs version 2.38 or newer. Sources: `debaser:src/git/git.ts:89-97`, `debaser:src/git/merge.ts:3-5`.
- *GitHub CLI* (`gh`) is GitHub's command-line client. debaser asks it for a pull request's title, state, and head branch; without it, pull requests still build, with less information. Sources: `debaser:src/github/gh.ts:14-38`, `debaser:src/plugins/sources/pr.ts:25-35`.
- *Bun* is the toolchain that compiles debaser's TypeScript source into its single executable (`bun build --compile`). It is needed only to build debaser itself from source. Sources: `debaser:package.json:10`, `debaser:.github/workflows/ci.yml:29`.
- *Coding agents* (Claude Code, Codex, pi, OpenCode, or any command) are command-line programs that edit code from a written task. debaser can hand a merge conflict or a failing check to one, then checks the agent's result itself. They are optional. Sources: `debaser:src/plugins/harness/registry.ts:8`, `debaser:src/harness/select.ts:41-44`, `debaser:src/harness/verify.ts:16-51`. No agent's own source is pinned (author's choice), see open question 1.

**Fit.** You keep an ordinary clone of the project with two remotes: `upstream` (the original) and `origin` (your fork). debaser keeps the patch list inside the clone's Git directory, builds in a second working directory next to the clone, resets its integration branch there to upstream, merges each patch in order, runs the recipe's checks and each patch's acceptance check, and installs the result. When a merge conflicts or a check fails, it calls the configured agent, accepts the change only when its own checks pass, and commits it separately. Sources: `debaser:src/core/paths.ts:6-16`, `debaser:src/core/tree.ts:32-40`, `debaser:src/run/build.ts:117`, `debaser:src/run/mergeloop.ts:37-83`, `debaser:src/run/verifyloop.ts:48-109`, `debaser:src/run/accept.ts:29-84`, `debaser:src/run/harness-merge.ts:18-23`, `debaser:src/run/harness-fix.ts:23-32`.

**Why this combination.** The obvious alternative is one long-lived branch on your fork that you merge or rebase by hand. debaser instead rebuilds the integration branch from upstream on every run, so each patch stays separate and can be retired on its own; it replays conflict resolutions Git recorded earlier; it tells an upstream breakage (exit 4) from a patch breakage (exit 3) by running the failing step on plain upstream; and it never touches the checkout you work in. Sources: `debaser:src/run/build.ts:117`, `debaser:src/cli/commands/remove.ts:22-24`, `debaser:src/git/git.ts:5`, `debaser:src/steps/isolated.ts:15-62`, `debaser:src/run/verifyloop.ts:80-109`, `debaser:tests/integration/tree.test.ts:76`.

**Status and limits.** debaser is at version 0.1.0, and the pinned source has no release workflow, so the guide installs it by building from source with Bun. Pull request sources are GitHub only. One changing command runs at a time per patch list. Sources: `debaser:package.json:3`, `debaser:.github/workflows/ci.yml:1-50`, `debaser:src/plugins/sources/pr.ts:10-17`, `debaser:src/core/lock.ts:27-58`.

## Purpose

A reader finishes the guide able to keep a patched build of a project they do not own: set it up once, rebuild it whenever upstream moves, understand and recover from every kind of stop, and, as a recipe author, teach debaser how a new project is built and checked and when to call a coding agent. Every statement is verified against debaser at the pinned commit; the existing README, `docs/*.md`, specs, and brainstorm notes are inputs only (hints, never proof).

Goals: a working first build within one page; a page for every stop a reader can hit; complete reference tables (commands, `patches.json`, recipe keys, exit codes, files, environment variables), written by hand and verified row by row against the code's own definitions (controller's call: no generator script, so the tables are ordinary page tasks that `/guide:evolve` keeps current through drift).

Non-goals: debaser development (contributing, tests, the behavior contract, pilot validation); features without code at the pinned commit (release downloads, Homebrew, the remote test runner, idea-inbox proposals).

Anti-goals: restating stale input claims (for example the `rebuild` verb, installing into the user's checkout, `steps.replace`); hedged second-hand definitions.

Examples (author's decision): commands on User guide pages use placeholders for the reader's own values (`<owner>/<repo>`, `<number>`, `<branch>`), and worked examples and every capture use the fictional `example/widget` project. No real project's pull request numbers appear on pages.

## Approaches

- **A. Task-sized pages (chosen by the author).** About 22 pages, each answering one question a reader arrives with; fits Antora navigation and keeps each page's source review focused.
- **B. Compact.** About 12 pages, one per area plus reference. Faster to write, but long pages and more scrolling for readers who arrive with one problem.

The author added a fourth capture: a regular successful build with the live progress view.

## Personas and journeys

**User** (entry `user/index`). Someone who runs a tool from another project with extra changes. Journey: start page, How a build works, Install, First build, then day 2 as needed: Managing the patch list, The build directory, When a build stops, Reading status, Rebasing your own branches, Running headless. Reference pages for exact flags and codes.

**Recipe author** (entry `recipe-author/index`). Someone who makes debaser build a project it has no built-in recipe for, adds acceptance checks to patches, or connects a coding agent. Often the same person as the User, later. Journey: start page, Key concepts, Recipes and layers, Steps, install, and build output, Acceptance checks, Setting up the harness, What the agent is asked and how its work is checked. Reference: recipe TOML and `patches.json`.

## Pages

Paths are relative to `content/modules/ROOT/pages/`. Voices: Overview `concepts`, User and Recipe author guides `technical`, Reference `reference`.

### Overview

1. **`index.adoc` (start page)**. Follows the overview contract's start page shape with the why card above: outcome first, what the parts are (debaser, Git, GitHub CLI, Bun, coding agents), how they fit and why together (with the `build-pipeline` diagram, small), ways to run it (interactively on a terminal with the live view, or headless with `--json`, one sentence each with links), status and limits, then one entry per persona and the baseline note. The opening leads with why someone needs debaser, names the situations it serves in one or two sentences, and links to `overview/why.adoc`.

1a. **`overview/why.adoc`: Why debaser** (added 2026-11-24). Prose page for readers who want the reasons before the mechanics: the problem in depth (a project you depend on and your changes drift apart); five use cases in prose (your own unmerged features on a project you contribute to; a downstream product that works upstream first but still carries patches, with OpenShift Routes before Kubernetes Ingress as the example; a team's internal build rebuilt headless; other people's open pull requests you need now; a maintainer's preview of several open pull requests together); History and prior art in three lineages (patch queues such as quilt, Debian, and RPM; long-lived downstreams such as OpenShift carries, Electron, and the Android Common Kernel; integration branches rebuilt from scratch such as git's `seen` and linux-next, with rerere); and where debaser fits among them. External facts cite `url:` sources (open question 1).
2. **`overview/how-it-works.adoc`: How a build works**. Opens with the `build-regular` capture as the first impression of a normal run. Walks the phases of one `debaser build` in order with the `build-pipeline` diagram: lock and preflight, fetch into debaser's own refs, rebase own branches, reset the integration branch to upstream, merge patches in order (skipping merged or contained ones), run the recipe steps (rerun once for flakiness, plain upstream to assign blame), run acceptance checks, install the artifact and keep the previous one, after-build command, report. Each phase names what can stop it and links to the stop page. Facts: C-BLD-*, C-VER-01 to 04, C-ACC-04, C-VER-09.
3. **`overview/concepts.adoc`: Key concepts**. Defines the terms every later page uses, each in one or two sentences with its source: upstream and origin, patch list and patch kinds (upstream PR, PR or branch of another repository, own branch), own versus someone else's patch, integration branch and previous build, build directory, data directory, recipe and its layers, step, acceptance check, harness, run, report, handoff. Shows the `where-things-live` diagram. Facts: research section 6 glossary.

### User guide

4. **`user/index.adoc`: User guide overview**. One paragraph on what this reader achieves (a patched build they can rebuild with one command and recover when it stops) and why it matters, then the page list with one line each. Follows the overview contract (cold-reader test).
5. **`user/install.adoc`: Install debaser**. Why paragraph; requirements (Git at the baseline minimum `{debaser-git-min}`, optional GitHub CLI and what you lose without it, optional agent CLIs); steps: clone debaser at the pinned commit, `bun install`, `bun run build`, copy `dist/debaser` onto `PATH`; `Check:` `debaser --version` prints the baseline version. States that no release binary is provided at the pinned commit. Facts: C-INS-02 to 06, `debaser:src/cli/main.ts:48-51`.
6. **`user/first-build.adoc`: Your first build**. Why paragraph; steps: clone your fork, add the `upstream` remote, first `debaser add` (creates the patch list, upstream from the `upstream` remote or `--upstream`), add one patch of each kind, `debaser list`, `debaser build`; `Check:` lines for the live view (shows the `build-regular` capture), the build directory created beside the clone, the installed artifact in the build directory, and `debaser status`. Mentions the recipe question (built-in recipe or the recipe author guide). Facts: C-SRC-01 to 03, C-TRE-02, C-TRE-05, C-BLD-11, C-CLI-15.
7. **`user/patch-list.adoc`: Managing the patch list**. Every source form `add` accepts with an example each; descriptions and PR titles; duplicates and refused sources (the integration branch, URLs with credentials); `--pin`; order; `remove --reason` (retiring) and `list`, `list --verbose`, `list --retired`, `list --json`; where the patch list lives and `--dir`/`DEBASER_DIR`; editing `patches.json` by hand. Facts: C-SRC-*, C-DIR-01, C-DIR-02, C-CLI-02 to 04.
8. **`user/build-directory.adoc`: The build directory**. Why debaser builds in a separate linked worktree; default location and the `tree` setting (absolute, relative, `.` for in place); what it refuses (modified tracked files, another branch, detached HEAD, a foreign path, the integration branch checked out elsewhere) and how to fix each; a deleted build directory is recreated; working in your own checkout during a build; starting from any worktree; which commands use it (`build`, `continue`, `rollback`) and which do not (`rebase`). Shows the `where-things-live` diagram. Facts: C-TRE-*, C-CFG-01.
9. **`user/stops.adoc`: When a build stops**. Why paragraph; how to read a stop (reason, build directory, log, report, ready-to-run prompt); one subsection per stop with what happened and what to do: merge conflict (exit 2), step fails only with patches (3), upstream itself broken (4), agent out of attempts or broken (5), acceptance check fails (6), interrupted (129, 130, 143); `continue` (what it commits, where it resumes, `--skip-branch`), `rollback` (with and without a stopped run); rerere replay on the next build; another command refused while a run is stopped or running. Shows the `build-stopped-conflict` capture. Facts: C-VER-*, C-BLD-09, C-DIR-04, C-EXT-01.
10. **`user/status.adoc`: Reading status**. What `debaser status` shows without changing anything (configuration lines, upstream commits since the last build, one row per patch: upstream merge state, own branch, PR state, behind, checks, patch check, pin); `--fetch`; `--json`; when it needs `gh`. Shows the `status` capture. Facts: C-STA-*, C-CFG-01, C-CFG-04.
11. **`user/own-branches.adoc`: Rebasing your own branches**. Which patches count as yours; what the rebase phase of a build does (throwaway worktrees, checks alone, backup refs) and the modes `all`, `conflicting`, `off`; `debaser rebase` on its own; pushing with a lease (`--push` or the terminal question); branches left alone (checked out elsewhere, diverged, already upstream) and `--in-worktree`; conflicts inside `build` versus `rebase`. Facts: C-REB-*, C-SRC-10, C-BLD-10.
12. **`user/headless.adoc`: Running headless**. Running from scripts or a scheduler: no terminal questions (trust, push, remove reason), `--trust-recipe`, `--push`, `--json` output (`result.json` fields) and the summary on stderr, exit codes to branch on, reports and `latest`, the lock. Facts: C-CLI-18, C-EXT-*, C-VER-15, C-DIR-04, research section 3 terminal behavior.

### Recipe author guide

13. **`recipe-author/index.adoc`: Recipe author guide overview**. One paragraph on what this reader achieves (debaser builds and checks a project correctly, and fixes routine breakage through an agent) and why, then the page list. Follows the overview contract.
14. **`recipe-author/recipes.adoc`: Recipes and their layers**. What a recipe is; the four layers (generic, built-in project, committed `.debaser/recipe.toml`, local `recipe.toml` in the data directory) and how each extends the one below; how the generic recipe is chosen (`recipe`, `extends`, detection) and the stops when none or several match; the built-in recipes (`bun-ts`, `rust-cargo`, `tals/corgi`, `rtk-ai/rtk`); trust for a committed recipe (`debaser trust`, terminal question, `--trust-recipe`, re-asked on change); `debaser recipe` to see the effective recipe with each value's layer. Shows the `recipe` capture. Facts: C-RCP-01 to 12, C-CFG-02.
15. **`recipe-author/steps.adoc`: Steps, install, and build output**. Writing steps (`run`, `parser`, `timeout`, `tests`), placing new steps (`before`, `after`, `steps_replace`), placeholders `{output}`, `{root}`, `{tests}`, failure parsers and the flaky rerun, the install step with triggers and marker, `artifact.output` and `artifact.install` (`artifact.install` relative to the build directory, `artifact.output` relative to the tree a step runs in for `{output}` and to the build directory for the install, `.prev` copy), `after_build`, `leftovers`, `project_name`, environment variables passed to steps. A worked local recipe for a small project. Facts: C-RCP-13 to 17, C-TRE-15, research 4.2.
16. **`recipe-author/acceptance-checks.adoc`: Acceptance checks**. Why a per-patch check; adding `acceptance` to a patch entry (`run`, `exit`, `match`, `timeout`); when it runs and with which environment (`DEBASER_ARTIFACT`); what a failure does (rerun, agent scoped to the patch, stop 6 with a handoff); flaky checks; how `list`, `status` (PATCH CHECK column), and the report show checks. Facts: C-ACC-*.
17. **`recipe-author/harness.adoc`: Setting up the harness**. The `harness` section of `patches.json`: `command` with `{prompt_file}`, `kind` (`claude`, `codex`, `pi`, `opencode`, `plain`) and what each adds, `timeoutSeconds`, `attempts`, per-task `tasks` and the kind fallback; one example per agent kind; permissions are the user's to grant in the command (debaser adds only streaming flags); a harness that is not executable. Facts: C-HAR-04 to 17, C-HAR-28, research section 5.
18. **`recipe-author/harness-verification.adoc`: What the agent is asked and how its work is checked**. The tasks (`conflict`, `check`, `acceptance`, `rebase-conflict`, `rebase-check`), the prompt templates and their overrides in the recipe, where prompts, logs, and raw streams are kept; how a conflict resolution and a fix are accepted, what a rejected attempt does, the fix bound and stop 5; commit messages and trailers per case, including the rebase-conflict exception; handoffs per patch. Facts: C-HAR-01 to 03, C-HAR-18 to 27, research section 5.

### Reference

19. **`reference/commands.adoc`: Commands**. Every verb with positionals, options, whether it takes the lock, terminal behavior, and JSON output; global `--dir`, `--version`, `--help`. Source: `debaser:src/cli/commands/index.ts:45-86`, `debaser:src/cli/usage.ts:1-43`, research section 3.
20. **`reference/patches-json.adoc`: `patches.json`**. Every key with type, default, and validation, including `harness` and `acceptance`; an annotated full example. Source: `debaser:src/core/patchlist.ts:9-189`, research 4.1.
21. **`reference/recipe-toml.adoc`: Recipe file**. Every key with type, meaning, default, and merge rule across layers; the built-in recipes table. Source: `debaser:src/recipes/schema.ts:5-91`, `debaser:src/recipes/resolve.ts:18-139`, research 4.2 and 4.3.
22. **`reference/files-and-codes.adoc`: Files, exit codes, and environment**. The data directory layout (including `lock` and `work/`), report contents and retention, `result.json` fields, refs under `refs/debaser/`, exit codes, environment variables read and set. Source: `debaser:src/core/paths.ts:27-39`, `debaser:src/report/report.ts:101-306`, `debaser:src/core/errors.ts:1-20`, research section 3.

## Diagrams

1. **`build-pipeline`**: the phases of one `debaser build` left to right (fetch, rebase own branches, reset, merge patches, steps, acceptance checks, install, after-build), with the stop exits branching off where they occur (2 at merge, 3 and 4 at steps, 6 at acceptance, 5 from agent attempts) and the agent as an optional helper box attached to merge, steps, and acceptance. Used on `index.adoc` (small) and `overview/how-it-works.adoc`. Sources: `debaser:src/run/build.ts:50-157`, `debaser:src/run/finish.ts:38-71`, `debaser:src/core/errors.ts:1-20`.
2. **`where-things-live`**: the user's clone (main worktree) with its shared Git directory holding `debaser/` (patch list, recipe override, reports), the build directory as a linked worktree beside it on the integration branch with the installed artifact, and the remotes `upstream` and `origin`. Used on `overview/concepts.adoc` and `user/build-directory.adoc`. Sources: `debaser:src/core/paths.ts:6-39`, `debaser:src/core/tree.ts:32-40`, `debaser:src/run/common.ts:66-74`.

Palette: debaser's own parts user blue, Git structures platform gray, the agent governance orange, stops admin red.

## Captured visuals

All `kind: cli`. One tool image, `localhost/debaser-visuals:<debaser version>`, built by a guide Makefile target (`make visuals-image`, run before `make visuals`) from a Containerfile committed under `visuals/`: Git 2.38 or newer and debaser compiled with Bun from `https://github.com/rhuss/debaser` at the pinned commit (the image build has network; the capture run does not). Controller's call: building from GitHub at the pinned commit keeps the image reproducible on any machine and in CI.

Three environments use that image, each with its own seed, so every capture's state is independent of capture order (controller's call; the capture tool runs one environment's visuals in sequence in one container). Read-only captures (`status`, `recipe`) share `widget`; each capture that changes state gets its own environment:
- **`widget`**: the fictional upstream project `example/widget` (a few shell scripts and a tiny test) in local bare repositories for `upstream` and `origin`, a second repository for a branch of another repository, and a clone with two patches that merge cleanly (an own branch and a branch of another repository by Git URL). The upstream commits a `.debaser/recipe.toml` (trusted in the seed with `--trust-recipe`), and the clone adds a local `recipe.toml` override, so `debaser recipe` shows two layers (controller's call: a shell project matches no built-in generic recipe, and an offline image cannot run Bun or Cargo projects). The seed runs one successful build and then adds one upstream commit, so `status` shows a last build and one new upstream commit. Used by `status` and `recipe`.
- **`widget-build`**: the same seed without the first build; used only by `build-regular`.
- **`widget-conflict`**: the same seed without the first build, plus a third own branch that conflicts with the first patch; used only by `build-stopped-conflict` (expected exit 2).

No GitHub, no `gh`, no agent; all names, commits, and contents are fictional. Masks fix durations, dates, temporary paths, and commit ids.

1. **`build-regular`**: a successful `debaser build` on a color terminal: the live view's final frame with each phase and step checked off and the summary line. Why: the first impression of a normal run. Pages: `overview/how-it-works.adoc`, `user/first-build.adoc`. Risk: the capture renders the final frame of the redrawn view; if the renderer does not replay cursor movement cleanly, fall back to the plain progress lines (stdout not a terminal) and tell the author.
2. **`build-stopped-conflict`**: a `debaser build` that stops at the conflicting patch (exit 2) with the stop message naming the files, the build directory, the report, and `continue`/`rollback`. Why: readers need to recognize a stop. Page: `user/stops.adoc`.
3. **`status`**: `debaser status` after the successful build: configuration lines and the per-patch table. Why: the table's columns are explained on the page. Page: `user/status.adoc`.
4. **`recipe`**: `debaser recipe` showing the effective recipe with each value's layer. Why: layering is easier to see than to read. Page: `recipe-author/recipes.adoc`.

## Experimental content

None. No change requests are documented.

## Internal part

None (in-repo guide in a public repository).

## Open questions

1. Git, GitHub CLI, Bun, and coding agent definitions come from debaser's own code and docs only; none of these products' own repositories or documentation is pinned (author's decision at intake, overview contract test 4 waived for them). Pages define each in one sentence stating only what debaser's sources support (what debaser uses it for), never general knowledge about the product. Exception (2026-11-24): `overview/why.adoc` may state facts about other tools, projects, and practices (history, prior art, upstream first, OpenShift and Kubernetes), each from a cited `url:` source, primary sources preferred; facts about debaser itself still come from the pinned source.
2. The README offers a release binary download, but the pinned source has no release workflow (C-INS-01, unverified). The install page builds from source only. The author decides whether releases will exist before the guide is published.
3. The minimum Bun version is only implied by the CI pin (`1.4.4`, `debaser:.github/workflows/ci.yml:29`); the README states a lower minimum. The install page names the CI version as the tested one, not as a minimum.
4. Input claims the pinned code contradicts are listed in the research notes, section 7 (19 items, for example the `rebuild` verb in spec-001, the artifact path in `docs/pilots.md`, the rebase-conflict commit exception, `gh` being optional for fetching PRs). Pages follow the code; the items become upstream findings at wrap-up.
5. The `build-regular` capture depends on the capture renderer replaying the live view's cursor control; fallback described above.

## Revision Notes

### 2026-11-24: Page titles and artifact paths after the copy-edit

- Clarified: Personas and journeys (Recipe author journey), Pages 15 (title "Steps, install, and build output"; how `artifact.output` and `artifact.install` resolve), Pages 17 (title "Setting up the harness")
- Rationale: the copy-edit renamed both pages to follow the styleguide glossary (no bare "artifact" in prose; the harness is what you set up), and the source shows `artifact.output` resolves against the tree a step runs in for `{output}`.

### 2026-11-24: Why debaser page with use cases and prior art

- Added: Pages 1a (`overview/why.adoc`, Why debaser)
- Clarified: Pages 1 (start page opening leads with the why and links Why debaser), Open questions 1 (external `url:` sources allowed on `overview/why.adoc`)
- Rationale: the author asked for more focus on why debaser exists, use cases in prose, and a researched history of carrying patches on top of an upstream; the overview contract has no start-page slot for them, so they get their own overview page.
