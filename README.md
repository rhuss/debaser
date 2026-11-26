# debaser

debaser keeps a patched build of someone else's GitHub project: upstream plus
your ordered list of patches (upstream PRs, PRs and branches from other forks,
and your own branches). Each `debaser build` fetches everything, rebases your
own branches, merges the patches in order, runs the project's checks and each
patch's acceptance check, and installs a runnable artifact. The previous build
stays as a fallback.

When a merge conflicts or a check fails, debaser can hand the problem to an AI
agent (claude, codex, pi, opencode or any command). It checks the agent's
result itself, and every agent change lands as its own commit. When the agent
can't fix it, or there is none, the run stops with a clear reason, a log, a
ready-to-run prompt, and `continue` and `rollback` to go on.

## Install

Download the release binary for your platform and put it on your `PATH`, or
build it from source with Bun 1.4 or newer:

```bash
bun install
bun run build          # writes dist/debaser, a single self-contained binary
cp dist/debaser ~/.local/bin/
```

At run time debaser needs only `git` (2.38 or newer) and, for PR sources, an
authenticated `gh`. Agent CLIs are optional.

## Quick start

In a clone of the project, with `upstream` pointing at the original
repository and `origin` at your fork:

```bash
debaser add 1234                      # an upstream PR; the first add creates the patch list
debaser add someone/project#56        # a PR on another repository
debaser add someone/project:topic     # a branch of another repository
debaser add my-branch "My change"     # your own branch, with a description
debaser build                       # build it
debaser status                        # what needs attention, without changing anything
```

## Patch list

The patch list is yours alone. It lives in `debaser/patches.json` inside the
checkout's shared git directory (`git rev-parse --git-common-dir`), outside the
working tree and shared by all worktrees of the checkout. `--dir <path>` or
`DEBASER_DIR` moves it (the option wins).

Sources can be written as a PR number (`123` or `#123`), `owner/repo#12`, a PR
URL, `owner/repo:branch`, a tree URL, `<git url>#branch=<name>`, or a local
branch name. `add --pin <sha>` merges a patch at exactly that commit and never
rebases it. `remove <source> --reason <text>` retires a patch; `list` shows the
live and retired ones.

The order of the list is the merge order. `add <source> --after <patch>` (or
`--before <patch>`) inserts a new patch at that place instead of the end, and
`move <patch> --after <patch>` (or `--before`) moves one. A patch is named by
its position in `list` (`3`) or by its source (`#12` is PR 12, as in `add`).
Plain `move` on a terminal asks which patch to move and where, and saves the
new order when you are done. `move --propose` test-merges the patches in memory,
without touching any checkout or ref, and suggests an order with fewer
conflicts: a patch goes after the patch it only merges cleanly on, and your own
branches go after the patches they clash with. It shows each move with its
reason and the conflicts no order avoids, and asks before it saves the order.
It uses the commits of the last fetch; add `--fetch` to fetch first, or `--yes`
to apply without asking. Reordering never resolves conflicts: the next `build`
does that. While a run is stopped, finish it with `continue` or `rollback`
before you reorder. After a reorder, `build` notes that recorded conflict
resolutions may not apply to the new order.

The list also holds the integration branch name (default `debaser`, with
`debaser-prev` as the previous build), the rebase mode (`all`, `conflicting`
or `off`), the harness settings, the build directory (`tree`), and optional
per-patch acceptance checks.

## Build directory

`build`, `continue` and `rollback` never touch the checkout you start them
from, unless that checkout is the build directory itself. They work in the
build directory: a linked worktree of the project that
holds the integration branch. By default it sits next to the main checkout as
`../<checkout name>-debaser` (for `~/src/corgi` that is `~/src/corgi-debaser`).
The first build creates it and records it as `"tree": "../corgi-debaser"` in
`patches.json`. You can keep editing, switching branches or running a dev
server in your own checkout while a build runs, and you can start debaser from
any worktree of the project.

The build output and the installed artifact (the recipe's `artifact.output`
and `artifact.install`) live in the build directory too, unless the recipe
gives an absolute path. Stops name the build directory: resolve a conflict or
fix a step there, then run `debaser continue` from wherever you are.

- Set `tree` yourself to put the directory elsewhere (absolute, or relative to
  the main checkout). debaser keeps the value as written.
- Set `"tree": "."` to build in place, in the main checkout itself, as a CI job
  with a single checkout needs. The checkout must then be clean.
- debaser refuses to build when the build directory has modified tracked files,
  sits on another branch, is not a worktree of this repository, or when the
  integration branch is checked out in another worktree (including your main
  checkout, which older debaser versions left on it: `git switch main` there
  first). Untracked files never block.
- A build directory you deleted is created again by the next build. debaser
  never deletes it; remove it with `git worktree remove ../corgi-debaser`.

`debaser list` and `debaser status` start with where everything is:

```text
data    /…/corgi/.git/debaser
config  /…/corgi/.git/debaser/patches.json  (local recipe: none)
build   /…/corgi-debaser
```

## Recipes

A recipe tells debaser how to check and build a project: named steps run in
order, the install step and the files that trigger it, the build output and
where to install it, an after-build command and prompt overrides. Recipes are
TOML and come in four layers, each extending the one below:

1. a generic recipe shipped with debaser (`bun-ts`, `rust-cargo`), detected from
   the project's files or named with `recipe` in the patch list;
2. a project recipe shipped with debaser, matched by the upstream repository;
3. a recipe the project commits at `.debaser/recipe.toml`, read from the
   fetched upstream tip and used only after you trust it (`debaser trust`, a
   question on a terminal, or `--trust-recipe`);
4. your local override in `debaser/recipe.toml` beside the patch list.

Steps merge by name: a step with an inherited name replaces it in place, a new
one goes `before` or `after` a named step (or at the end), and
`steps_replace = true` drops the inherited list, and
`after_build = []` switches an inherited after-build command off. `debaser recipe` prints the
effective recipe with the layer of every value, and where each layer came
from (built-in, the committed file at its upstream commit, or the local
override's path).

Steps get `DEBASER_PATCHES`, `DEBASER_FORK_URL`, `DEBASER_COMMIT` and
`DEBASER_MANIFEST` (a JSON manifest with the same data), so a project can stamp
its build. Placeholders in step commands: `{output}` (the build output path),
`{root}` (the tree) and `{tests}` (the failing test files on a flaky rerun; on a
full run, the step's `tests` list, or nothing when it has none).

## Acceptance checks

Project-wide checks say the combined build works; an acceptance check says a
patch still does what it is for. Attach one to a patch in `patches.json`:

```json
{
  "source": { "kind": "pr", "repo": "rtk-ai/rtk", "number": 2569 },
  "description": "podman rewrite support",
  "added": "2026-11-21",
  "acceptance": { "run": ["{output}", "rewrite", "podman ps"], "exit": 0, "match": "rtk podman" }
}
```

It runs after every step passed, from the tree root, with `DEBASER_ARTIFACT`
set to the build output. It passes on the expected exit code (default 0) and,
with `match`, when the regular expression is found in the combined output.
The default timeout is 300 seconds. A failing check blames only its patch.
`list` marks patches that have a check with `(with check)`.

## Agent harnesses

Configure an agent in the patch list's `harness` section. debaser adds only
the flags that turn on the agent's event stream and never translates tool
permissions. See [docs/harness.md](docs/harness.md) for a safe example command
per agent, per-task harnesses, timeouts and attempt limits.

## Own branches

Your own branches (local branches, and PRs or branches whose head repository
is the one `origin` pushes to) are rebased onto upstream in throwaway
worktrees, checked alone, and backed up under `refs/debaser/rebase-backup/`.
`debaser rebase` does only that. Pushes always use a lease and need `--push`
or a yes on the terminal. Other people's branches are never rewritten.

## Commands

| Command | What it does |
|---|---|
| `add <source> [description] [--pin <sha>] [--upstream owner/repo]` | add a patch |
| `add <source> --after <patch>` / `--before <patch>` | add a patch at that place in the merge order |
| `remove <source> --reason <text>` | retire a patch |
| `move <patch> --after <patch>` / `--before <patch>` | move a patch in the merge order |
| `move` | reorder with numbered prompts on a terminal |
| `move --propose [--fetch] [--yes]` | propose an order with fewer merge conflicts and apply it on yes |
| `list [--json]` | show the patches |
| `build [--push] [--rebase all\|conflicting\|off] [--in-worktree] [--trust-recipe] [--verbose] [--json]` | merge the patches onto upstream, run the checks and install the artifact |
| `rebase [--push] [--rebase all\|conflicting] [--in-worktree] [--verbose] [--json]` | only rebase own branches |
| `continue [--skip-branch] [--verbose]` | resume a stopped run |
| `rollback [--verbose]` | return to the last good build |
| `status [--fetch] [--json]` | show each patch and upstream drift, read only |
| `recipe [--json]` | print the effective recipe with each value's layer |
| `trust` | trust the project's own recipe |

Only one command that changes things runs per checkout at a time; `status`,
`list` and `recipe` never wait. On a terminal, `build`, `rebase` and
`continue` show a live view; piped, they print plain progress lines.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | usage or precondition error (modified files in the build directory, a run stopped or running, git too old, fetch failure, untrusted project recipe in a headless run, no matching recipe), or a refused push of a rebased branch |
| 2 | stopped at an unresolved merge conflict, or a rebase conflict in `rebase` |
| 3 | stopped at a step that fails only on the patched tree |
| 4 | the step fails on plain upstream too: upstream is broken |
| 5 | the harness ran out of attempts, hit the fix bound, or kept failing to run |
| 6 | stopped at a failing acceptance check |
| 129, 130, 143 | ended by SIGHUP, SIGINT or SIGTERM; `continue` or `rollback` handles the run |

## Data directory

```text
<git-common-dir>/debaser/
├── patches.json      your patch list
├── recipe.toml       optional local recipe override
├── trust.json        trusted project-recipe fingerprints
├── run.json          a running or stopped run
├── timings.json      timing history for the live view's estimates
├── manifest.json     the last build's manifest
└── reports/          one directory per run (report.md, result.json, logs,
                      prompts, handoffs), `latest`, the ten newest kept
```

## Development

```bash
bun test               # unit and integration tests (a temporary repository "test world")
bun run typecheck
bun run build
```

[docs/behavior-contract.md](docs/behavior-contract.md) lists every scenario of
the tool debaser replaces as carried over (with its test) or dropped (with
the reason). [docs/pilots.md](docs/pilots.md) describes the manual pilot runs.
