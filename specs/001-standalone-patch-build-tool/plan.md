# Implementation Plan: debaser v1, a standalone tool for patched builds

**Branch**: `001-standalone-patch-build-tool` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-standalone-patch-build-tool/spec.md`

## Summary

debaser rebuilds an upstream GitHub project plus an ordered patch list into a verified, runnable artifact, with agent repair that debaser checks itself. Approach B from the brainstorm: the plugin interfaces (patch source, recipe, failure parser, harness adapter, acceptance check) are defined first, and the reference tool's behavior (tals/corgi#117, `scripts/custom_build/`) is rebuilt underneath them, guarded by a ported test world and a behavior-contract document that lists every reference test as carried or dropped. Delivery is phased by story priority so the P1 stories (rebuild, stops and recovery) are a working MVP before agent repair, acceptance checks, rebasing, status, layered recipes and the live view are added.

## Technical Context

**Language/Version**: TypeScript (strict) on Bun 1.4, compiled with `bun build --compile` (research R1)

**Primary Dependencies**: none at runtime besides `git` (2.38 or newer) and `gh`; agent CLIs optional. Dev only: `@types/bun`, `typescript`

**Storage**: JSON and TOML files in `<git-common-dir>/debaser/` (data-model.md); git refs under `refs/debaser/`

**Testing**: `bun test`; unit tests beside pure modules, integration tests against a temporary repository "test world" with a fake `gh` and stub harnesses (research R9), smoke tests against the compiled binary

**Target Platform**: macOS and Linux (x64, arm64) terminals and CI runners

**Project Type**: CLI (single project)

**Performance Goals**: startup under 100 ms warm (spike: 40 ms); `status` under 10 s on the rtk pilot without `--fetch` (SC-003); live view redraws at most every 100 ms

**Constraints**: single binary (spike: 85 MB); never rewrite or push what isn't the user's; every agent change a separate verified commit; plain output identical with and without the live view

**Scale/Scope**: about 10 patches per project, tens of steps, runs of minutes to an hour; reference size about 6,900 lines of code and 245 tests to match

## Global Constraints

- git 2.38 or newer; `gh` for PR metadata; no other runtime dependency.
- Names: `debaser` prefix for refs (`refs/debaser/`), env vars (`DEBASER_*`), commits (`debaser: fix ...`); no corgi or custom-build names outside the corgi recipe.
- Defaults: harness timeout 900 s, 3 attempts, fix bound attempts × (steps + acceptance checks); acceptance check timeout 300 s; 10 run reports and 10 rollback logs kept.
- A patch skipped as merged or contained runs no acceptance check and is reported as `skipped`.
- Recipes have no version key; an unknown key (as a newer debaser would write) is refused, naming the file and key.
- SC-009, SC-011 and SC-012 (formerly SC-002, SC-008 and the rtk timing of SC-003) need real forks, network and weeks of use; they are validated manually after merge (`docs/pilots.md`, T086), not in CI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no project principles exist to check against. Gate: **pass (no constitution)**. The spec's own non-negotiables are treated as gates instead and are met by the design:

| Gate (from spec) | How the design meets it |
|---|---|
| No corgi code or names in the core (FR-050, SC-004) | corgi lives only in `src/recipes/builtin/tals-corgi.toml`; quickstart step 2 greps for violations; a test enforces it |
| Behavior contract (FR-052, SC-001) | `docs/behavior-contract.md` plus `tests/contract.test.ts` |
| No silent agent changes (SC-007) | core-owned verification (`src/harness/verify.ts`), agent commits marked with trailers |
| Single binary, no runtime deps (FR-051) | research R1; embedded prompts and recipes |

Post-design re-check: pass, no violations to track.

## Project Structure

### Documentation (this feature)

```text
specs/001-standalone-patch-build-tool/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   ├── plugins.md
│   └── recipe.md
└── tasks.md            # created by /speckit-tasks
```

### Source Code (repository root)

```text
package.json, tsconfig.json, bunfig.toml
src/
├── types/assets.d.ts         # text imports for embedded .md/.toml
├── cli/
│   ├── main.ts               # main(argv, io) -> exit code; argument parsing, dispatch, output mode
│   ├── usage.ts
│   └── commands/             # add.ts remove.ts list.ts rebuild.ts rebase.ts continue.ts rollback.ts status.ts recipe.ts trust.ts
├── core/
│   ├── paths.ts              # debaser dir resolution (FR-001)
│   ├── patchlist.ts          # load/validate/save patches.json (atomic), bootstrap (FR-001a)
│   ├── runstate.ts           # run.json types, load/save/clear
│   ├── lock.ts               # FR-001b
│   ├── errors.ts             # Explained (exit 1 with a message), exit code constants
│   └── context.ts            # Context passed through a run: io, sink, repo, dir, recipe, clock
├── git/
│   ├── git.ts                # spawnSync wrapper, interrupt exit codes, version check
│   ├── merge.ts              # merge --no-ff with rerere, remerge, merge-tree checks
│   ├── worktree.ts           # throwaway worktrees, checkedOutIn
│   ├── refs.ts               # refs/debaser names, update-ref transactions
│   ├── snapshot.ts           # tree snapshots and changedSince
│   └── remotes.ts            # push URL, lease push, sameRepository
├── github/gh.ts              # gh pr view wrapper (null when gh missing)
├── plugins/
│   ├── sources/              # types.ts registry.ts branch.ts pr.ts fork-branch.ts parse.ts
│   ├── parsers/              # types.ts registry.ts bun-test.ts tsc.ts cargo-test.ts generic.ts
│   └── harness/              # types.ts registry.ts claude.ts codex.ts pi.ts opencode.ts plain.ts
├── recipes/
│   ├── schema.ts             # TOML validation
│   ├── resolve.ts            # layers, merge rules, provenance (FR-039..FR-044)
│   ├── trust.ts              # trust.json, fingerprints
│   └── builtin/              # bun-ts.toml rust-cargo.toml tals-corgi.toml rtk-ai-rtk.toml index.ts
├── steps/
│   ├── commands.ts           # placeholder expansion ({output} {tests} {root})
│   ├── run.ts                # runStep, runWithRetry (flaky), timeouts
│   ├── install.ts            # install trigger
│   ├── isolated.ts           # plain-upstream and patch-alone runs in worktrees
│   └── attribute.ts          # FR-027
├── harness/
│   ├── invoke.ts             # spawn, process group, timeout, logs, usage
│   ├── verify.ts             # acceptConflict, acceptFix, discard
│   ├── select.ts             # per-task harness (FR-023)
│   └── prompts.ts            # template fill, overrides
├── prompts/                  # conflict.md check.md acceptance.md rebase-conflict.md rebase-check.md handoff.md
├── run/
│   ├── rebuild.ts            # phase driver
│   ├── fetch.ts              # upstream and patches, skip merged/contained (FR-005, FR-007)
│   ├── mergeloop.ts          # FR-006, conflicts, harness
│   ├── verifyloop.ts         # FR-008, FR-012, FR-020, FR-021
│   ├── accept.ts             # FR-028..FR-030
│   ├── finish.ts             # install artifact, -prev, after-build, push (FR-008a, FR-010, FR-011)
│   ├── stop.ts               # stop records, blame, fix prompt
│   ├── resume.ts             # continue (FR-015)
│   └── rollback.ts           # FR-016
├── rebase/
│   ├── select.ts             # ownership, targets (FR-031, FR-032, FR-034)
│   ├── rebase.ts             # worktree rebase, conflicts, checks, fixes (FR-031a, FR-035a)
│   └── push.ts               # lease push, pending (FR-033)
├── report/
│   ├── report.ts             # report.md, result.json, latest, prune
│   ├── handoff.ts            # FR-026
│   └── manifest.ts           # FR-045
├── timings/timings.ts
├── live/                     # events.ts state.ts render.ts screen.ts worker.ts live.ts term.ts task-view.ts
└── views/                    # list.ts status.ts recipe.ts
tests/
├── support/world.ts          # test world: bare repos, fake gh, stub steps, stub harness
├── integration/              # one file per story area
├── smoke/                    # compiled binary
├── contract.test.ts
└── independence.test.ts      # SC-004
docs/
├── behavior-contract.md
├── harness.md                # safe example command per agent (FR-025)
└── pilots.md                 # post-merge manual validation (SC-009, SC-011, SC-012)
README.md
```

**Structure Decision**: Single CLI project. Plugins sit behind registries in `src/plugins/` and `src/recipes/`; the run state machine in `src/run/` only talks to them through `contracts/plugins.md`. Pure modules (parsers, adapters' stream parsing, recipe merge, live state and render, reports) are unit tested; everything touching git is tested through the test world.

## Delivery phases

Tasks will follow these phases; each ends with all tests green.

1. **Foundation**: package and build script, `main(argv, io)` skeleton, errors and exit codes, paths, lock, git wrapper, test world, plugin interfaces and registries, behavior-contract skeleton (all reference tests listed as `pending`).
2. **MVP, US1 and US2 (P1)**: sources and `add`/`remove`/`list`, patch list bootstrap, generic and project recipes (layers 1 and 2), fetch, merge loop with rerere, verify loop with flaky rerun and plain-upstream blame, artifact install and `-prev`, after-build, stops, `continue`, `rollback`, reports, `--json`, push of the integration branch. Plain output only.
3. **US3 harness and handoffs (P2)**: adapters, invoke, verification, attempts and fix bound, per-task harness, prompts, attribution, handoffs.
4. **US4 acceptance checks (P2)**: runner, blame, harness fix, exit 6, unverified.
5. **US5 own-branch rebasing (P2)**: select, worktree rebase, rebase conflicts and fixes, lease push, pending, in-worktree mode, `rebase` command.
6. **US6 status (P3)**, **US7 layered recipes (P3)**: project-repo recipe and trust, local overrides, `recipe` and `trust` commands (the stamping manifest already lands in phase 2).
7. **US8 live view and timings (P3)**: events, worker, renderer, timings, card, notifications.
8. **Polish**: behavior contract complete, compiled-binary smoke tests, README and `docs/harness.md`, pilot runs.

## Complexity Tracking

No constitution violations to justify.

## Revision Notes

### 2026-11-21: Reconcile review-code deviations with the behavior contract

**Change**: pilot criteria SC-002, SC-003 (rtk timing) and SC-008 → SC-009, SC-012 and SC-011, validated after merge; handoff kinds and stamping variables follow the superseding requirements.
**Rationale**: the code follows carried behavior-contract scenarios where the spec text disagreed; the pilots need real forks and weeks of use.
**Requirements**: FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, SC-009, SC-010, SC-011, SC-012
