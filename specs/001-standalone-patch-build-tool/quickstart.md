# Quickstart: validating debaser v1

Run guide that proves the feature end to end. Commands and formats are defined in [contracts/cli.md](contracts/cli.md), [contracts/recipe.md](contracts/recipe.md) and [data-model.md](data-model.md).

## Prerequisites

- Bun 1.4 or newer (build only), git 2.38 or newer, `gh` authenticated (pilot runs only).
- For harness checks: any of `claude`, `codex`, `pi`, `opencode` on `PATH` (optional).

## 1. Build and test

```bash
bun install
bun test                      # unit + integration (test world, fake gh, stub harness)
bun run build                 # bun build --compile -> dist/debaser
./dist/debaser --version
bun test tests/smoke          # runs the compiled binary against a temporary repository pair
```

Expected: all tests pass; `tests/contract.test.ts` confirms every `carried` entry in `docs/behavior-contract.md` names an existing test (SC-001).

## 2. Independence check (SC-004)

```bash
rg -il corgi src/ --glob '!src/recipes/builtin/tals-corgi.toml'
```

Expected: no output.

## 3. Scenario: rebuild, stop, continue, rollback (US1, US2)

Covered by `tests/integration/rebuild.test.ts` and `tests/integration/stops.test.ts`. Manual variant on a throwaway clone of any Bun or Cargo project with an `upstream` remote and a fork as `origin`:

```bash
debaser add 1234                         # an upstream PR; creates the patch list
debaser add my-own-branch
debaser recipe                           # shows the effective recipe and layers
debaser rebuild; echo "exit=$?"          # 0, artifact at the recipe's install path
debaser rollback                         # back to the previous build
```

Expected: integration branch `debaser` = upstream plus one `Merge ...` commit per live patch; `reports/latest/report.md` and `result.json` exist under `$(git rev-parse --git-common-dir)/debaser/`.

## 4. Scenario: harness repair (US3)

Configure a harness in `patches.json` (for example `{"command": ["claude", "-p", "--allowedTools", "Edit,Read", "@{prompt_file}"], "kind": "claude"}`), create a conflicting patch pair, run `debaser rebuild`. Expected: the merge commit carries `Resolved-By: harness`; `reports/latest/prompts/` holds the prompt, readable log, raw `.jsonl` and token counts in the report.

## 5. Scenario: acceptance checks (US4)

Add an `acceptance` entry to one patch (example in contracts/recipe.md), leave another without. Expected: `result.json` shows `pass`/`fail` for the first and `none` for the second; a failing check without a harness exits 6 with a handoff for that patch only.

## 6. Scenario: own-branch rebase (US5)

Put an own branch behind upstream, run `debaser rebase`, answer the push prompt. Expected: `refs/debaser/rebase-backup/<branch>` holds the old tip; the fork branch moved with a lease; someone else's PR was not touched.

## 7. Scenario: status (US6, SC-010, SC-012)

```bash
time debaser status
debaser status --json | jq '.patches[] | {display, pr, merges, rebase, acceptance}'
```

Expected: one row per patch plus upstream drift; under 10 s on the rtk pilot without `--fetch`; `git status` and refs unchanged afterwards.

## 8. Pilots (SC-009)

- **rtk**: clone `rtk-ai/rtk` with `upstream` = rtk-ai/rtk and `origin` = your fork; add the four patches from the brainstorm (#2569, #4891, two own branches); `debaser rebuild --trust-recipe`. Expected: `dist/rtk-custom` runs (`dist/rtk-custom --version`).
- **corgi**: in a corgi checkout, add the patches from the existing `.custom-build/config.json` by hand; `debaser rebuild`. Expected: `dist/corgi-custom` runs and the after-build reload fires.
