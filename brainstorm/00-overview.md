# Brainstorm Overview

Last updated: 2026-11-26

## Sessions

| # | Date | Topic | Status | Spec | Issue |
|---|------|-------|--------|------|-------|
| 01 | 2026-11-22 | build-worktree | spec-created | 002 | - |
| 02 | 2026-11-23 | acceptance-labels | approved | - | - |
| 03 | 2026-11-23 | remote-test-runner | idea | - | - |
| 04 | 2026-11-26 | patch-ordering | active | - | - |

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

## Parked Ideas
