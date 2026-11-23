# Brainstorm: Run the test suite on a remote machine

**Date:** 2026-11-23
**Status:** idea

## Problem Framing

The full suite (`bun test`, ~390 tests) takes 16 to 21 minutes on the development Mac. Profiling one test showed where the time goes:

| Phase | Time |
|---|---|
| `world()` (fresh upstream, fork, clone on disk) | ~1.0 s |
| two patch branches | ~0.6 s |
| one `debaser build` | ~1.8 s, about 60 `git` processes |

Each process start costs 15 to 20 ms here, because CrowdStrike Falcon, XProtect and `opendirectoryd` check every exec. Those services serialize, so the parallel runner (`scripts/test-parallel.sh`, now used in CI) does not help locally:

| Run | Wall time | Failures |
|---|---|---|
| serial | ~16 to 21 min | 0 |
| parallel, 14 jobs | ~10 min | 2, from timing tests under load |
| parallel, 7 jobs | ~19 min | 2, from timing tests under load |

A Linux machine without those agents starts a process in 1 to 2 ms, and parallel files should overlap there. The expectation (not measured yet) is a few minutes for the whole suite.

Success: one command from the local checkout runs the suite on a remote host and reports the result as if it ran locally, in a few minutes.

Failure even if it works: it needs manual setup on every run, it leaves stale copies or processes on the host, or two runs from different sessions clobber each other.

## Approaches Considered

### A: `scripts/test-remote.sh`: rsync the tree, run over ssh
- Pros: the smallest step. Editing stays local, only the test run moves. It reuses `test:parallel`. The exit code and output come back over ssh.
- Cons: needs a prepared host (Bun 1.4.x, git identity). Syncing `.git` on every run costs some time.

### B: Run the whole debaser session on the remote (Claude Code over ssh, or a remote session)
- Pros: every test and build is fast, not only the suite.
- Cons: local tools (Obsidian, clipboard, the corgi checkout that debaser builds) stay on the Mac. It's a bigger change to how the user works.

### C: Fewer process spawns in the test world
- Pros: helps everywhere, including CI and the local Mac. One example is a cached seed repository copied with `cp -R` instead of being rebuilt with git commands for each test.
- Cons: a larger refactor of `tests/support/world.ts`. The build itself still spawns git per merge.

### D: Rely on CI only
- Pros: already there (CI now runs `test:parallel` on Linux and macOS runners).
- Cons: a push per check and a wait for the queue; no quick loop while developing.

## Decision

Not decided yet. The leaning is A first (cheap, immediate), with C as a separate follow-up that helps on every machine.

## Key Requirements (proposed, not yet agreed)

- The host comes from `DEBASER_TEST_HOST` or `--host <ssh-target>` (`user@host` or a `~/.ssh/config` name). There is no default.
- Sync the working tree including `.git`, excluding `node_modules`, `dist` and `.git/debaser`, to a per-checkout directory on the host (for example `~/debaser-test/<checkout-name>/`), so two checkouts don't share one copy.
- On the host: `bun install --frozen-lockfile`, then `bun run test:parallel` (or `bun test` with `--serial`). The output streams back, and the script exits with the remote exit code.
- Set the git identity the integration tests need for the remote run only (as the CI workflow does), without touching the host's global config. One way is `GIT_CONFIG_GLOBAL` pointing at a file inside the sync directory.
- Fail early, with a clear message, when the host is unreachable or has no `bun` of the expected version.
- A `test:remote` script in `package.json`.

## Open Questions

- Which host? It needs an ssh target with Bun 1.4.x, or permission to install it there.
- Should the script install Bun on the host when it is missing, or only refuse with the install command?
- Should two concurrent runs from the same checkout be refused (a lock on the host), or each get its own directory?
- How much does syncing `.git` cost per run once the repository grows? Is `git bundle` or a remote fetch cheaper?
- Is a first measurement needed before building anything? `bun test tests/integration/acceptance.test.ts` on the host against 130 s locally would settle the expected speedup.
