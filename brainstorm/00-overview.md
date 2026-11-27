# Brainstorm Overview

Last updated: 2026-11-27

## Sessions

| # | Date | Topic | Status | Spec | Issue |
|---|------|-------|--------|------|-------|
| 01 | 2026-11-22 | build-worktree | spec-created | 002 | - |
| 02 | 2026-11-23 | acceptance-labels | approved | - | - |
| 03 | 2026-11-23 | remote-test-runner | idea | - | - |
| 04 | 2026-11-26 | patch-ordering | spec-created | 003 | - |
| 05 | 2026-11-26 | propose-merged-state | active | - | - |
| 06 | 2026-11-27 | release-pipeline | active | - | [#12](https://github.com/rhuss/debaser/issues/12), [#13](https://github.com/rhuss/debaser/issues/13) |

## Open Threads
- Which host runs the remote suite, and may the script install Bun there? (from #03)
- Refuse concurrent remote runs from one checkout, or give each its own directory? (from #03)
- Cost of syncing `.git` per remote run versus `git bundle` or a remote fetch (from #03)
- Measure one integration file on the remote before building the script? (from #03)
- Does `move --propose` fetch first, or use the last fetched refs with an optional `--fetch`? (from #04)
- How is a stacked patch detected: contained commits, one-order-only merge result, or the PR's base branch? (from #04)
- Should `status` hint when another order would avoid conflicts? (from #04)
- How does the proposal treat pinned patches and patches with acceptance checks? (from #04)
- Is a run in progress detected from the lock as well as the stopped run state? (from #04)
- Batch the `gh` PR-state lookups for long lists? (from #05)
- Distinguish gh missing, not logged in and network errors in the fallback note? (from #05)
- Hint at `--fetch` when a merged PR's merge commit is not in the last fetch? (from #05)
- Where do the apt repository and its signing key live? (from #06)
- Which tokens write to the tap, COPR and AUR, and how are they held? (from #06)
- Which runner serves x64 macOS now that `macos-13` is retired? (from #06)
- Is `brew install` on Linux in scope, or macOS only? (from #06)
- Does the arm64 Linux build use `ubuntu-24.04-arm` like the other targets run natively? (from #06)
- First release version: tag `0.1.0`, or bump before the first tag? (from #06)
- Which license do the Fedora spec and the formula declare, given there is no LICENSE file? (from #06)

## Parked Ideas
