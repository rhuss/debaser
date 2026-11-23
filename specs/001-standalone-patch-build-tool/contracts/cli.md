# Contract: debaser command line

One standalone command, `debaser <verb> [options]` (FR-054). All verbs accept `--dir <path>` (overrides `DEBASER_DIR`, which overrides `<git-common-dir>/debaser`). Diagnostics go to stderr; machine-readable output (`--json`) goes to stdout.

## Verbs

| Verb | Synopsis | Lock | Notes |
|---|---|---|---|
| `add` | `add <source> [description] [--pin <sha>] [--upstream owner/repo]` | yes | First `add` creates `patches.json` (FR-001a). Sources: `123`, `#123`, `owner/repo#12`, PR URL, `owner/repo:branch`, tree URL, `<git url>#branch=<name>`, `<local-branch>`. PR titles come from `gh`. Refuses duplicates, the integration branch, `<branch>-prev`, URLs with credentials. |
| `remove` | `remove <source> --reason <text>` | yes | Retires the patch; off a terminal `--reason` is required, on a terminal it is asked for. |
| `list` | `list [--json]` | no | Live and retired patches; pinned and with-check marks. |
| `rebuild` | `rebuild [--push] [--rebase all\|conflicting\|off] [--in-worktree] [--trust-recipe] [--verbose] [--json]` | yes | FR-005 to FR-011. |
| `rebase` | `rebase [--push] [--rebase all\|conflicting] [--in-worktree] [--verbose] [--json]` | yes | Own branches only (FR-031 to FR-035a). |
| `continue` | `continue [--skip-branch] [--verbose]` | yes | Resumes a stopped `rebuild` or `rebase` (FR-015); `--skip-branch` only for a stopped rebase. |
| `rollback` | `rollback [--verbose]` | yes | FR-016. |
| `status` | `status [--fetch] [--json]` | no | Read only (FR-036, FR-037). |
| `recipe` | `recipe [--json]` | no | Effective recipe with the layer of each value (FR-044). |
| `trust` | `trust` | yes | Shows the project-repo recipe's commands and records its fingerprint after confirmation (FR-042). |
| `help`, `--help`, `--version` | | no | Usage names `--verbose` for every verb with a live view. |

## Exit codes (FR-013)

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | usage or precondition error (dirty checkout, run stopped or running, lock held, git older than 2.38, fetch failure, untrusted project recipe in a headless run, own branch known only from a stale remote copy, no matching recipe or several matching generic recipes); also a finished run whose push of a rebased branch was refused |
| 2 | stopped at an unresolved merge conflict, or at a rebase conflict in `rebase` |
| 3 | stopped at a step failing only on the patched tree |
| 4 | the step fails on plain upstream too |
| 5 | harness out of attempts, fix bound reached, or harness kept exiting non-zero without an acceptable result |
| 6 | stopped at a failing acceptance check with no accepted fix |
| 129, 130, 143 | ended by SIGHUP, SIGINT, SIGTERM |

## Output modes

- **Terminal** (stdout is a TTY, `NO_COLOR` unset, `TERM` not `dumb`): live view; `--verbose` pins it above the full log.
- **Piped**: plain progress lines `debaser: <line>` on stderr, child output echoed to stderr. Identical with and without an event sink (FR-046).
- **`--json`**: `result.json` content on stdout at the end (data-model.md), in addition to the plain stderr lines.

## Prompts

`rebuild --push`/`rebase` ask before pushing rebased branches when on a terminal and `--push` is not given; off a terminal they never push without `--push`. `trust` asks for confirmation. A headless run never prompts: it fails with exit 1 where an answer is required.

## Environment

| Variable | Use |
|---|---|
| `DEBASER_DIR` | data directory override |
| `DEBASER_GITHUB` | base URL standing in for `https://github.com` (tests use `file://`) |
| `NO_COLOR`, `TERM` | output mode |
| set for steps and checks (also on side trees; always the integration build, FR-059) | `DEBASER_PATCHES`, `DEBASER_FORK_URL`, `DEBASER_COMMIT`, `DEBASER_MANIFEST` |
| set for acceptance checks | the above plus `DEBASER_ARTIFACT` |
| set for the harness | `DEBASER_TASK` (`conflict`, `check`, `acceptance`, `rebase-conflict`, `rebase-check`), `DEBASER_PROMPT` (prompt file path) |
