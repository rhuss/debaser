# debaser Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A source-verified Antora guide for debaser 0.1.0 with 22 pages for two personas (User, Recipe author), 2 diagrams, and 4 captured CLI visuals.

**Architecture:** Visual tasks first (capture environment, then one task per visual), then diagram tasks, then page tasks in navigation order. Every page is verified against the pinned `debaser` source; inputs are hints only. Page tasks follow `page-procedure.md`, diagram tasks the `guide:diagrams` skill.

**Tech Stack:** Antora (AsciiDoc, one sentence per line), cc-guide toolkit (`make check`, `tools/guide/*.py`), Excalidraw MCP for diagrams, podman for captures.

**Spec:** `docs/guide/spec.md` (read its `## Why` card, page outlines, diagram and visual sections). Research notes with claim ids `C-*` and the full command, schema, and harness tables: `.guide/runs/2026-11-23-create/research.md` (local, git-ignored; read it, never copy it).

## Global Constraints

- Guide: "debaser Guide", format `antora`, rigor `standard`, cc-prose present (present: write with the section voice profiles and run the prose check; absent: follow `style-rules.md`). No cc-prose voice profiles are configured, so the section voices are the built-in styles `concepts`, `technical`, and `reference` from `style-rules.md`, applied through `prose:content-generator`; the prose check still runs.
- Baseline (captured 2026-11-23); every statement is verified at these commits, never at a branch head:

  | Source | Repository | Commit |
  |---|---|---|
  | `debaser` | https://github.com/rhuss/debaser | `b46fcb260a1eb248a046999317cbfa98f73cb31b` |

- Baseline values available to pages (never type versions or commits): `{debaser-repo}`, `{debaser-commit}`, `{debaser-commit-short}`, `{debaser-blob}`, `{debaser-tree}`, `{debaser-version}` (0.1.0), `{debaser-git-min}` (2.38), `{debaser-bun-tested}` (1.4.4, the Bun version CI tests with), `{baseline-date}`, `{baseline-sources}`.
- Change requests documented as experimental (label only through the adapter snippet): none.
- Personas and their entry pages: User (`user/index`), Recipe author (`recipe-author/index`).
- Sections and voices: Overview (`concepts`), User guide (`technical`), Recipe author guide (`technical`), Reference (`reference`).
- Every page starts with a source block after the title; entries are `<source-id>:<path>[:<lines>]`, `url:<url>`, or (internal pages only) `input:<input-id>`. Facts without a pinned source stay out of the page.
- Inputs are hints, never proof. Registered inputs: `readme`, `harness-doc`, `behavior-contract`, `pilots-doc`, `spec-001`, `spec-002`, `brainstorm-overview`, `brainstorm-build-worktree`, `brainstorm-acceptance`, `brainstorm-remote-test`, `idea-inbox`. Content derived from a confidential input (none) appears only on internal pages.
- Shareable pages never contain: no confidential terms, no confidential patterns, and no links into an internal part (the guide has none).
- No em dash or en dash characters in any file.
- AsciiDoc, one sentence per line; source block as `// Sources:` lines; expectations as `// expect:`; baseline values as `{<name>}` (listings need `subs="attributes+"` and no `${VAR}`); experimental labels through `ROOT:partial$experimental-<tier>.adoc` with the anchor on the section heading; images `image::<name>.svg["<alt>",role=expand]` with quoted alt text; pages under `content/modules/ROOT/pages/`, internal pages under `internal/modules/internal/pages/`.
- Admonitions: only NOTE, TIP, IMPORTANT, WARNING, CAUTION, with their fixed meanings (see `page-procedure.md`).
- Task pages: a why-paragraph, numbered steps with copy-paste commands, `Check:` lines with expectations.
- The start page and the section overview pages follow `overview-contract.md`: why before how, the spec's `## Why` card as their content, every product defined from its own pinned source, and the cold-reader test as their review gate.
- Read every pinned source in the directory printed by `uv run tools/guide/fetch.py where <source-id>`, never in the working tree of a repository.
- Diagrams follow the diagrams skill. Every label, arrow, and frame is a claim with a source in the diagram's claims file (`diagrams/<name>.claims.yaml`); where a product runs its parts comes from its own architecture documentation at the pinned version. Palette: platform gray (`#e9ecef`/`#495057`), governance orange (`#ffe8cc`/`#e8590c`), admin red (`#ffe3e3`/`#c92a2a`), user blue (`#d0ebff`/`#1971c2`); text and legends `#495057`.
- Run every command from the guide project root with path arguments; never `cd` into `.guide/cache/`.
- Containers: `podman`, never `docker`. Python packages: `uv`, never pip.
- Commit messages end with the trailer `Assisted-By: 🤖 Claude Code`. Only the controller pushes, and only when the author opted in (pushes after each completed task).
- Examples: commands use placeholders for the reader's own values (`<owner>/<repo>`, `<number>`, `<branch>`); worked examples and every capture use the fictional project `example/widget`. No real project's pull request numbers on pages.
- The pages follow the pinned code where inputs disagree (research notes section 7). Never present as current: the `rebuild` verb, installing into the user's checkout, a dirty-checkout refusal of the start checkout, `steps.replace`, release binary downloads, Homebrew, the remote test runner, idea-inbox proposals. Report each contradiction you meet under Findings or Upstream candidates.
- Terms and spellings from `styleguide.md` (lowercase "debaser" everywhere, "build directory", "patch list", "integration branch", "acceptance check", "harness").

## Review Focus

1. A reader on a fresh clone with no `upstream` remote: the first-build page must say what `add` does then (refuses with instructions, or `--upstream`) (Task 12).
2. A reader without `gh`: install, first-build, and patch-list pages must say what still works and what is lost (description required for PR `add`, no titles, squash-merged PRs merged again, own PRs not rebased) (Tasks 11, 12, 13).
3. A reader who edits files in the build directory or checks out the integration branch in the main clone: build-directory and stops pages must name each refusal and its fix (Tasks 14, 15).
4. A reader running headless (no terminal): trust, push, and remove-reason questions are refused or skipped; headless and recipes pages must say which flag replaces each question (Tasks 18, 20).
5. A reader whose harness task entry sets a command without `kind`: the harness page must state that it falls back to `plain`, not to the top-level kind (Task 23).

Reviewers check each of these on the named page as a required spot-check.

---

## Visuals

### Task 1: Capture environment and visual `build-regular`

**Files:**
- Create: `visuals/Containerfile`, `visuals/seed/widget.sh`, `visuals.yaml`
- Modify: `Makefile` (target `visuals-image`), `.gitignore` if needed

**Interfaces:**
- Produces: image `localhost/debaser-visuals:0.1.0`; seed script `visuals/seed/widget.sh <mode>` with modes `built` (environment `widget`), `fresh` (environment `widget-build`), `conflict` (environment `widget-conflict`); the clone at `/work/widget` in every environment (the capture's working directory); `visuals.yaml` with `defaults.width: 100`, `defaults.prompt: "$ "`, three environments, and masks reused by Tasks 2 to 4.

- [ ] **Step 1:** `visuals/Containerfile`: a Bun image pinned by tag `1.4.4` (the CI version, `debaser:.github/workflows/ci.yml:29`) as build stage that clones `https://github.com/rhuss/debaser` and checks out `b46fcb260a1eb248a046999317cbfa98f73cb31b`, runs `bun install --frozen-lockfile` and `bun run build`; a runtime stage with Git `>= 2.38` (for example a Debian or Alpine base whose Git version is at least 2.38) and `dist/debaser` on `PATH`. No `gh`, no agent CLIs. Set `git config --system` user name `Widget Maintainer`, email `maintainer@example.com`, `init.defaultBranch main`.
- [ ] **Step 2:** Makefile target `visuals-image`: `podman build -t localhost/debaser-visuals:0.1.0 -f visuals/Containerfile visuals`. Add it to `.PHONY` and the help text. Run it. Expected: `podman image exists localhost/debaser-visuals:0.1.0` exits 0.
- [ ] **Step 3:** `visuals/seed/widget.sh` (POSIX sh, offline): creates bare repos `/srv/upstream/widget.git`, `/srv/origin/widget.git`, `/srv/forks/helper/widget.git`; an upstream `main` with `widget.sh`, `test.sh` (a tiny shell test), and a committed `.debaser/recipe.toml` (steps `lint` and `test` as short shell commands, `artifact.output = "dist/widget"`, `artifact.install = "dist/widget-custom"`, a `build` step that copies `widget.sh` to `{output}`); a clone `/work/widget` with remotes `upstream` and `origin`; own branch `fast-start`, a branch `helper-colors` on the helper fork; `debaser add --upstream example/widget fast-start "Start faster"` and `debaser add /srv/forks/helper/widget.git#branch=helper-colors "Colored output"` (verify both source forms against `debaser:src/plugins/sources/fork-branch.ts:26-33` and `debaser:src/cli/commands/add.ts:26-77`; adjust to the form the code accepts and record it); a local override `recipe.toml` in the data directory adding one step `smoke` after `test`; `debaser trust` is interactive, so trust with the first build's `--trust-recipe`. Mode `built`: run `debaser build --trust-recipe` once, then add one upstream commit and push it to the upstream bare repo. Mode `fresh`: no build (the capture command itself passes `--trust-recipe`). Mode `conflict`: `fresh` plus own branch `rename-flag` that edits the same line as `fast-start`, added third. All data fictional.
- [ ] **Step 4:** `visuals.yaml`: environments `widget`, `widget-build`, `widget-conflict`, each `kind: cli`, `image: localhost/debaser-visuals:0.1.0`, `source: debaser`, one seed step `run: sh /visuals/seed/widget.sh <mode>` with `files: [seed/widget.sh]`. Visual `build-regular`: `kind: cli`, `env: widget-build`, command `cd /work/widget && debaser build --trust-recipe` (if the recipe format allows a working directory or `env_vars`, prefer that so the shown command is `debaser build --trust-recipe`), expected exit 0. Masks: durations (`\d+(\.\d+)?\s?(ms|s|m)\b` and `\d+:\d\d` clock forms as they appear in the live view), dates `\d{4}-\d{2}-\d{2}`, commit ids `\b[0-9a-f]{7,40}\b`, run ids. Determine the actual duration formats from `debaser:src/live/render.ts` before writing the masks.
- [ ] **Step 5:** `uv run tools/guide/visuals.py validate` passes. Then `make visuals VISUALS=build-regular`. Expected: `captured`. Open the SVG: it must show the final live view frame (phases and steps checked, summary line). If it shows repeated frames or control garbage, change the command so stdout is not a terminal (plain progress lines, `debaser:src/cli/commands/index.ts:104-127`), recapture, and report the fallback.
- [ ] **Step 6:** Commit `docs(visuals): add capture environment and build-regular` with the trailer.

### Task 2: Visual `status`

**Files:** Modify `visuals.yaml`.
**Interfaces:** Consumes environment `widget` (mode `built`) from Task 1. Produces visual `status` for Task 16.

- [ ] **Step 1:** Add visual `status`: `kind: cli`, `env: widget`, command `debaser status` in `/work/widget`, exit 0, masks from Task 1 plus home and temporary paths. It must show the configuration lines, one new upstream commit, and two patch rows (`debaser:src/views/status.ts:120-139`).
- [ ] **Step 2:** `uv run tools/guide/visuals.py validate`; `make visuals VISUALS=status`. Expected: `captured`.
- [ ] **Step 3:** Commit `docs(visuals): add status` with the trailer.

### Task 3: Visual `recipe`

**Files:** Modify `visuals.yaml`.
**Interfaces:** Consumes environment `widget`. Produces visual `recipe` for Task 20.

- [ ] **Step 1:** Add visual `recipe`: `kind: cli`, `env: widget`, command `debaser recipe`, exit 0. It must show the layers `repo:.debaser/recipe.toml@<sha7>` and `local` and each step's layer (`debaser:src/views/recipe.ts:4-54`); mask the sha7.
- [ ] **Step 2:** Validate and `make visuals VISUALS=recipe`. Expected: `captured`.
- [ ] **Step 3:** Commit `docs(visuals): add recipe` with the trailer.

### Task 4: Visual `build-stopped-conflict`

**Files:** Modify `visuals.yaml`.
**Interfaces:** Consumes environment `widget-conflict`. Produces visual `build-stopped-conflict` for Task 15.

- [ ] **Step 1:** Add visual `build-stopped-conflict`: `kind: cli`, `env: widget-conflict`, command `debaser build --trust-recipe`, `exit: 2`. It must show the stop naming the conflicting patch and files, the build directory, the report, and `continue`/`rollback` (`debaser:src/run/stop.ts:24-56`, `debaser:src/run/mergeloop.ts:72-79`).
- [ ] **Step 2:** Validate and `make visuals VISUALS=build-stopped-conflict`. Expected: `captured`.
- [ ] **Step 3:** Commit `docs(visuals): add build-stopped-conflict` with the trailer.

## Diagrams

### Task 5: Diagram `build-pipeline`

- **Shows:** the phases of one `debaser build` left to right: lock and preflight, fetch (into `refs/debaser/`), rebase own branches, reset integration branch to upstream, merge patches in order, recipe steps, acceptance checks, install (previous kept), after-build, report. Stop exits branch off downward: 2 at merge, 3 and 4 at steps, 6 at acceptance, 5 from the agent box. An optional "coding agent" box attaches to merge, steps, and acceptance with dashed arrows labelled "conflict", "failing step", "failing check".
- **Entities and palette:** phases user blue; Git refs and branches platform gray; coding agent governance orange; stop exits admin red.
- **Used on:** `index.adoc` (Task 7) and `overview/how-it-works.adoc` (Task 8).
- **Source hints:** `debaser:src/run/build.ts:50-157`, `debaser:src/run/fetch.ts`, `debaser:src/run/rebase-phase.ts:1-125`, `debaser:src/run/mergeloop.ts:37-83`, `debaser:src/run/verifyloop.ts:48-109`, `debaser:src/run/accept.ts:90-227`, `debaser:src/run/finish.ts:38-71`, `debaser:src/core/errors.ts:1-20`, `debaser:src/harness/select.ts:7`.

### Task 6: Diagram `where-things-live`

- **Shows:** the user's clone (main worktree) with its shared Git directory containing `debaser/` (`patches.json`, `recipe.toml`, `reports/`); the build directory `../<clone>-debaser` as a linked worktree on the integration branch holding the build output and installed artifact (and `.prev`); remotes `upstream` (original project) and `origin` (your fork); arrows: fetch from both remotes, push own branches and (with `--push`) the integration branch to `origin`.
- **Entities and palette:** clone and build directory user blue; Git directory, refs, and remotes platform gray.
- **Used on:** `overview/concepts.adoc` (Task 9) and `user/build-directory.adoc` (Task 14).
- **Source hints:** `debaser:src/core/paths.ts:6-39`, `debaser:src/core/tree.ts:32-40,140-152`, `debaser:src/run/common.ts:66-74`, `debaser:src/run/finish.ts:42-87`, `debaser:src/rebase/rebase.ts:758-796`.

## Pages: Overview

All Overview pages: voice `concepts`, persona both, not internal. Navigation: `* Overview` (plain text) with `** xref:index.adoc[Start here]`, `** xref:overview/how-it-works.adoc[How a build works]`, `** xref:overview/concepts.adoc[Key concepts]`.

### Task 7: Start page `index.adoc`

- **Page:** `content/modules/ROOT/pages/index.adoc` (replace the scaffold page). Follows `overview-contract.md`; paste the spec's `## Why` card into the dispatch.
- **Outline:** the contract's start page shape: outcome first (Problem, Outcome); what the parts are (debaser, Git, GitHub CLI, Bun, coding agents); how they fit and why together, with `image::build-pipeline.svg[...]` small; ways to run it (on a terminal with the live view; headless with `--json`), one sentence each with links to `user/first-build.adoc` and `user/headless.adoc`; status and limits; where to go next, one entry per persona, then the baseline note.
- **Product definitions (own source):** debaser `debaser:README.md:3-14`, `debaser:package.json:10`; Git `debaser:src/git/git.ts:89-97`; GitHub CLI `debaser:src/github/gh.ts:14-38`; Bun `debaser:package.json:10`, `debaser:.github/workflows/ci.yml:29`; coding agents `debaser:src/plugins/harness/registry.ts:8`, `debaser:src/harness/select.ts:41-44` (no own source pinned, spec open question 1).
- **Facts:** all source hints of the why card in the spec.
- **Rules (`content/modules/ROOT/pages/index.adoc`):** require `include::(ROOT:)?partial\$baseline-note\.adoc\[\]`, `xref:user/index\.adoc`, `xref:recipe-author/index\.adoc`, `image::build-pipeline\.svg`; require_order `xref:user/index\.adoc`, `xref:recipe-author/index\.adoc`. Global rule (`content/modules/ROOT/pages/**/*.adoc`): forbid `debaser rebuild`, `steps\.replace`, `releases/download`, `brew install`.

### Task 8: How a build works `overview/how-it-works.adoc`

- **Outline:** spec page 2. Opens with `image::visuals/build-regular.svg[...]` (cite `visual:build-regular`), then the phases with `image::build-pipeline.svg[...]`, each naming what can stop it and linking to `user/stops.adoc`.
- **Facts:** C-BLD-01 to 06, C-BLD-08, C-BLD-09, C-VER-01 to 04, C-VER-09, C-ACC-04, C-REB-05, C-REB-06; hints `debaser:src/run/build.ts:50-157`, `debaser:src/run/fetch.ts:23-82`, `debaser:src/run/mergeloop.ts:37-83`, `debaser:src/run/verifyloop.ts:48-109`, `debaser:src/steps/isolated.ts:15-62`, `debaser:src/run/accept.ts:90-227`, `debaser:src/run/finish.ts:38-93`, `debaser:src/core/lock.ts:27-58`.
- **Rules:** require `image::build-pipeline\.svg`, `visuals/build-regular\.svg`, `xref:user/stops\.adoc`; require_order `[Ff]etch`, `[Mm]erge`, `[Aa]cceptance`, `[Ii]nstall`.

### Task 9: Key concepts `overview/concepts.adoc`

- **Outline:** spec page 3, a definition list in reading order with `image::where-things-live.svg[...]`.
- **Facts:** research section 6 glossary; hints `debaser:src/core/context.ts:46-52`, `debaser:src/plugins/sources/types.ts:1-5`, `debaser:src/rebase/rebase.ts:91-143`, `debaser:src/core/patchlist.ts:33`, `debaser:src/run/finish.ts:42-55`, `debaser:src/core/tree.ts:1-40`, `debaser:src/core/paths.ts:4-39`, `debaser:src/recipes/resolve.ts:100-139`, `debaser:src/run/accept.ts:25-84`, `debaser:src/harness/select.ts:7-52`, `debaser:src/core/runstate.ts:9`, `debaser:src/report/handoff.ts:13`.
- **Rules:** require `image::where-things-live\.svg`, `integration branch`, `build directory`, `patch list`, `acceptance check`.

## Pages: User guide

All User guide pages: voice `technical`, persona User, not internal. Navigation: `* xref:user/index.adoc[User guide]` with `**` items in task order.

### Task 10: User guide overview `user/index.adoc`

- **Outline:** spec page 4. Follows `overview-contract.md` (section overview: one paragraph on what the User achieves and why, then the page list). Paste the spec's `## Why` card into the dispatch.
- **Product definitions:** as Task 7 for any product the page names.
- **Rules:** require `xref:user/install\.adoc`, `xref:user/first-build\.adoc`, `xref:user/stops\.adoc`.

### Task 11: Install debaser `user/install.adoc`

- **Outline:** spec page 5. Build from source only; no release binary at the pinned commit. Bun version named as the version CI tests with, not as a minimum (spec open question 3). `Check:` `debaser --version` with `// expect: contains "{debaser-version}"` (listing with `subs="attributes+"`).
- **Facts:** C-INS-02 to 06, `debaser:package.json:3,5,10`, `debaser:.github/workflows/ci.yml:27-29`, `debaser:src/git/git.ts:89-97`, `debaser:src/cli/main.ts:48-51,83-85`, `debaser:src/github/gh.ts:14-38`, `debaser:src/plugins/sources/pr.ts:25-35`, `debaser:src/cli/commands/add.ts:67-74`, `debaser:src/rebase/rebase.ts:133-136`.
- **Rules:** require `^Check:`, `bun run build`, `\{debaser-git-min\}`, `\{debaser-version\}`; require_order `git clone`, `bun install`, `bun run build`, `debaser --version`.

### Task 12: Your first build `user/first-build.adoc`

- **Outline:** spec page 6, with placeholders for the reader's project. Shows `image::visuals/build-regular.svg[...]` as the expected live view (cite `visual:build-regular`). Covers the no-`upstream`-remote case (Review Focus 1) and the recipe question (link to `recipe-author/recipes.adoc`).
- **Facts:** C-SRC-01 to 03, C-TRE-02, C-TRE-05, C-BLD-11, C-CLI-15, C-RCP-03; hints `debaser:src/cli/commands/add.ts:26-77`, `debaser:src/core/patchlist.ts:186-189`, `debaser:src/core/tree.ts:32-40,149-152`, `debaser:src/run/common.ts:66-74`, `debaser:src/run/build.ts:63`, `debaser:src/cli/commands/index.ts:104-127`, `debaser:src/recipes/resolve.ts:112-129`.
- **Rules:** require `^Check:`, `visuals/build-regular\.svg`, `--upstream`; require_order `git remote add upstream`, `debaser add`, `debaser build`, `debaser status`.

### Task 13: Managing the patch list `user/patch-list.adoc`

- **Outline:** spec page 7. Table of source forms with a placeholder example each.
- **Facts:** C-SRC-01 to 09, C-DIR-01, C-DIR-02, C-CLI-02 to 04; hints `debaser:src/plugins/sources/pr.ts:10-35`, `debaser:src/plugins/sources/fork-branch.ts:9-34`, `debaser:src/plugins/sources/branch.ts:11-53`, `debaser:src/plugins/sources/parse.ts:24-36`, `debaser:src/cli/commands/add.ts:52-77`, `debaser:src/cli/commands/remove.ts:12-26`, `debaser:src/views/list.ts:32-83`, `debaser:src/cli/commands/list.ts:13-33`, `debaser:src/core/paths.ts:6-16`.
- **Rules:** require `--pin`, `--reason`, `list --verbose`, `DEBASER_DIR`.

### Task 14: The build directory `user/build-directory.adoc`

- **Outline:** spec page 8 with `image::where-things-live.svg[...]`. One subsection per refusal with its fix (Review Focus 3).
- **Facts:** C-TRE-01 to 16, C-TRE-19, C-TRE-20, C-CFG-01; hints `debaser:src/core/tree.ts:32-179`, `debaser:src/git/git.ts:102-119`, `debaser:src/run/resume.ts:39-42`, `debaser:src/run/rollback.ts:64-70,152-153`, `debaser:src/run/rebase-phase.ts:130-187`, `debaser:src/views/config.ts:9-30`.
- **Rules:** require `image::where-things-live\.svg`, `"tree"`, `git switch`.

### Task 15: When a build stops `user/stops.adoc`

- **Outline:** spec page 9. Shows `image::visuals/build-stopped-conflict.svg[...]` (cite `visual:build-stopped-conflict`) in the conflict subsection. Subsections in exit-code order.
- **Facts:** C-VER-01 to 08, C-VER-12, C-BLD-09, C-DIR-04, C-EXT-01, C-HAR-10, C-HAR-11, C-TRE-11, C-TRE-12; hints `debaser:src/run/stop.ts:24-145`, `debaser:src/run/mergeloop.ts:72-79`, `debaser:src/run/verifyloop.ts:48-109`, `debaser:src/run/resume.ts:29-143`, `debaser:src/run/rollback.ts:60-171`, `debaser:src/core/errors.ts:1-20`, `debaser:src/cli/main.ts:110-118`, `debaser:src/git/git.ts:5`.
- **Rules:** require `visuals/build-stopped-conflict\.svg`, `debaser continue`, `debaser rollback`; require_order `exit code 2|\b2\b`, `\b3\b`, `\b4\b`, `\b5\b`, `\b6\b` (adjust the regexes to the headings you write, keep the order 2, 3, 4, 5, 6).

### Task 16: Reading status `user/status.adoc`

- **Outline:** spec page 10. Shows `image::visuals/status.svg[...]` (cite `visual:status`), then one row per column of the table.
- **Facts:** C-STA-01 to 05, C-CFG-01, C-CFG-04; hints `debaser:src/cli/commands/status.ts:66-164`, `debaser:src/views/status.ts:49-139`, `debaser:src/views/config.ts:9-30`, `debaser:src/rebase/rebase.ts:199-204`.
- **Rules:** require `visuals/status\.svg`, `--fetch`, `PATCH CHECK`.

### Task 17: Rebasing your own branches `user/own-branches.adoc`

- **Outline:** spec page 11.
- **Facts:** C-REB-01 to 09, C-SRC-10, C-BLD-10, C-CLI-06, C-CLI-14; hints `debaser:src/rebase/rebase.ts:60-796`, `debaser:src/run/rebase-phase.ts:40-257`, `debaser:src/git/refs.ts:3-15`, `debaser:src/plugins/sources/branch.ts:17-53`, `debaser:src/cli/commands/rebase.ts:10-17`.
- **Rules:** require `--in-worktree`, `--rebase`, `conflicting`, `--skip-branch`.

### Task 18: Running headless `user/headless.adoc`

- **Outline:** spec page 12. Table: terminal question, what happens headless, the flag that replaces it (Review Focus 4).
- **Facts:** C-CLI-18, C-EXT-01 to 04, C-VER-15, C-DIR-04, C-BLD-06, C-BLD-07, C-RCP-08; research section 3 (JSON outputs, terminal behavior); hints `debaser:src/cli/main.ts:124-127`, `debaser:src/cli/commands/index.ts:104-156`, `debaser:src/report/report.ts:226-306`, `debaser:src/recipes/trust.ts:69-107`, `debaser:src/run/finish.ts:72-87`, `debaser:src/cli/commands/remove.ts:20-21`.
- **Rules:** require `--json`, `--trust-recipe`, `--push`, `result\.json`.

## Pages: Recipe author guide

All pages: voice `technical`, persona Recipe author, not internal. Navigation: `* xref:recipe-author/index.adoc[Recipe author guide]` with `**` items in task order.

### Task 19: Recipe author guide overview `recipe-author/index.adoc`

- **Outline:** spec page 13. Follows `overview-contract.md` (section overview). Paste the spec's `## Why` card into the dispatch. Product definitions as Task 7 for any product named (coding agents in particular).
- **Rules:** require `xref:recipe-author/recipes\.adoc`, `xref:recipe-author/harness\.adoc`.

### Task 20: Recipes and their layers `recipe-author/recipes.adoc`

- **Outline:** spec page 14. Shows `image::visuals/recipe.svg[...]` (cite `visual:recipe`).
- **Facts:** C-RCP-01 to 12, C-CFG-02; hints `debaser:src/recipes/resolve.ts:18-139`, `debaser:src/recipes/trust.ts:11-107`, `debaser:src/recipes/builtin/*.toml`, `debaser:src/recipes/builtin/index.ts:1-16`, `debaser:src/views/recipe.ts:4-54`, `debaser:src/cli/commands/recipe.ts:13-41`, `debaser:src/cli/commands/trust.ts:12-28`, `debaser:src/core/paths.ts:29`.
- **Rules:** require `visuals/recipe\.svg`, `\.debaser/recipe\.toml`, `debaser trust`, `debaser recipe`.

### Task 21: Steps, install, and artifact `recipe-author/steps.adoc`

- **Outline:** spec page 15, ending with a worked local recipe for a small project (verify every key against `debaser:src/recipes/schema.ts:5-91`).
- **Facts:** C-RCP-05, C-RCP-07, C-RCP-13 to 17, C-TRE-15, C-BLD-05, research 4.2; hints `debaser:src/recipes/schema.ts:5-91`, `debaser:src/recipes/resolve.ts:28-85`, `debaser:src/steps/commands.ts:7-23`, `debaser:src/steps/run.ts:42-79`, `debaser:src/steps/install.ts:6-26`, `debaser:src/run/common.ts:66-74`, `debaser:src/run/finish.ts:38-71`, `debaser:src/report/manifest.ts:17-64`, `debaser:src/plugins/parsers/registry.ts:1-17`, `debaser:src/run/leftover.ts:1-11`.
- **Rules:** require `steps_replace`, `\{output\}`, `\{tests\}`, `after_build`, `DEBASER_PATCHES`.

### Task 22: Acceptance checks `recipe-author/acceptance-checks.adoc`

- **Outline:** spec page 16 with one full `acceptance` example in `patches.json`.
- **Facts:** C-ACC-01 to 11, C-SRC-09; hints `debaser:src/core/patchlist.ts:11,59-79`, `debaser:src/run/accept.ts:25-227`, `debaser:src/run/build.ts:136-156`, `debaser:src/report/handoff.ts:141-166`, `debaser:src/views/list.ts:56`, `debaser:src/views/status.ts:133-138`, `debaser:src/report/report.ts:168-224`.
- **Rules:** require `DEBASER_ARTIFACT`, `"match"`, `"timeout"`, `PATCH CHECK`.

### Task 23: Setting up the agent `recipe-author/harness.adoc`

- **Outline:** spec page 17, one `harness` example per kind. States the task-entry kind fallback to `plain` (Review Focus 5) and that permissions are granted in the command by the user.
- **Facts:** C-HAR-04 to 17, C-HAR-28, research section 5; hints `debaser:src/core/patchlist.ts:14-19,99-164`, `debaser:src/harness/select.ts:7-52`, `debaser:src/harness/invoke.ts:19-108`, `debaser:src/plugins/harness/claude.ts`, `codex.ts`, `pi.ts`, `opencode.ts`, `plain.ts`, `registry.ts`.
- **Rules:** require `\{prompt_file\}`, `timeoutSeconds`, `attempts`, `"kind"`, `plain`.

### Task 24: What the agent is asked and how its work is checked `recipe-author/harness-verification.adoc`

- **Outline:** spec page 18. A table of commit messages and trailers per case, including the rebase-conflict exception (no separate commit, no trailer).
- **Facts:** C-HAR-01 to 03, C-HAR-18 to 27, research section 5; hints `debaser:src/harness/verify.ts:16-58`, `debaser:src/run/harness-merge.ts:18-95`, `debaser:src/run/harness-fix.ts:23-185`, `debaser:src/rebase/rebase.ts:410-525,684-756`, `debaser:src/harness/prompts.ts:9-32`, `debaser:src/prompts/`, `debaser:src/recipes/types.ts:1`, `debaser:src/report/handoff.ts:13-166`, `debaser:src/run/resume.ts:129`.
- **Rules:** require `Resolved-By: harness`, `Fixed-By: harness`, `DEBASER_TASK`, `rebase_conflict`.

## Pages: Reference

All pages: voice `reference`, persona both, not internal. Navigation: `* Reference` (plain text) with `**` items in task order. No prose check on these table pages (page procedure).

### Task 25: Commands `reference/commands.adoc`

- **Outline:** spec page 19; one table row per verb (positionals, options, lock, notes) plus global options and a JSON output subsection.
- **Facts:** research section 3; hints `debaser:src/cli/commands/index.ts:45-156`, `debaser:src/cli/usage.ts:1-43`, `debaser:src/cli/args.ts:3-28`, `debaser:src/cli/main.ts:35-127`, each command file under `debaser:src/cli/commands/`.
- **Rules:** require each verb: `\badd\b`, `\bremove\b`, `\blist\b`, `\bbuild\b`, `\brebase\b`, `\bcontinue\b`, `\brollback\b`, `\bstatus\b`, `\brecipe\b`, `\btrust\b`, and `--dir`.

### Task 26: `patches.json` `reference/patches-json.adoc`

- **Outline:** spec page 20; key table and an annotated full example.
- **Facts:** research 4.1; hints `debaser:src/core/patchlist.ts:9-189`, `debaser:src/harness/select.ts:11-22`, `debaser:src/run/accept.ts:36-38,75`.
- **Rules:** require `upstream\.repo`, `"rebase"`, `"tree"`, `"harness"`, `"retired"`, `"acceptance"`.

### Task 27: Recipe file `reference/recipe-toml.adoc`

- **Outline:** spec page 21; key table with merge rule per key and the built-in recipes table.
- **Facts:** research 4.2 and 4.3; hints `debaser:src/recipes/schema.ts:5-91`, `debaser:src/recipes/types.ts:1-39`, `debaser:src/recipes/resolve.ts:18-139`, `debaser:src/recipes/builtin/*.toml`.
- **Rules:** require `steps_replace`, `leftovers`, `install\.triggers`, `artifact\.install`, `rtk-ai/rtk`, `tals/corgi`.

### Task 28: Files, exit codes, and environment `reference/files-and-codes.adoc`

- **Outline:** spec page 22.
- **Facts:** C-DIR-03, C-VER-15, C-EXT-01 to 04, research section 3 (environment variables, exit codes, JSON), glossary refs; hints `debaser:src/core/paths.ts:27-39`, `debaser:src/report/report.ts:101-306`, `debaser:src/core/errors.ts:1-20`, `debaser:src/git/refs.ts:3-15`, `debaser:src/report/manifest.ts:17-64`, `debaser:src/harness/invoke.ts:33-58`, `debaser:src/git/git.ts:43-71`.
- **Rules:** require `\block\b`, `work/`, `result\.json`, `DEBASER_DIR`, `129`, `130`, `143`.
