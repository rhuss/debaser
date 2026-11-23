# Acceptance Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop calling patches without an acceptance check "unverified"; mark the patches that have one instead.

**Architecture:** The acceptance result value `"unverified"` becomes `"none"` everywhere it is stored or emitted (run state, `result.json`, `status --json`). Human-facing views hide `"none"`: `list` marks patches *with* a check, `status` shows `-`, the build summary and `report.md` leave those patches out.

**Tech Stack:** TypeScript, Bun (`bun test`, `tsc --noEmit`).

**Spec:** `brainstorm/02-acceptance-labels.md`

## Global Constraints

- `list` marker text is exactly `(with check)`; patches without a check get no marker.
- `status` ACCEPTANCE cell for a patch without a check is exactly `-`.
- Machine value for "no acceptance check" is exactly `"none"` (in `result.json` and `status --json`).
- The live build view keeps the text `no acceptance check` (dim).
- No change to how checks run, blame, harness fixes, or exit codes.
- No em-dashes or en-dashes in any prose or doc text.

## Review Focus

1. A `result.json` written before this change still says `"unverified"`; `status` reads it as last-build data. Expected: shown as `-`, and `status --json` reports `"none"`. Test added in Task 2.
2. Every patch lacks a check. Expected: `report.md` has no "Acceptance checks" section at all (not a section saying "none"). Test added in Task 1.
3. A patch with a check that was skipped as merged upstream. Expected: still listed in `report.md` as `skipped`, since only patches without a check are dropped. Covered by the filter definition in Task 1 (filter on the patch having a check, not on the result value).
4. A pinned patch with a check in `list`. Expected: `(pinned abc1234) (with check)`, pin first. Test added in Task 2.
5. A patch with a check that has not run yet in `status`. Expected: `-` (unchanged) and `null` in JSON, distinct from `"none"`. Existing status test row `acme/widget#3` covers the ran case; behavior for not-run is unchanged code.

---

### Task 1: Rename the result to `"none"` and drop it from the build summary and report

**Files:**
- Modify: `src/core/runstate.ts:73` (`AcceptanceResult.result` union: `"unverified"` to `"none"`)
- Modify: `src/run/accept.ts:103` (push `result: "none"`)
- Modify: `src/run/finish.ts:126-128` (delete the `unverified: …` summary line)
- Modify: `src/report/report.ts:214-252` (`acceptanceRows` fallback and doc comment, `result()` fallback, report section filter)
- Modify: `src/live/render.ts:366` (`case "none":`, text unchanged)
- Modify docs: `specs/001-standalone-patch-build-tool/spec.md` (line 106 independent test, line 112 scenario 3, FR-030 line 280), `specs/001-standalone-patch-build-tool/data-model.md` (lines 128, 131, 162), `specs/001-standalone-patch-build-tool/quickstart.md:50`, `README.md:105`
- Test: `tests/integration/acceptance.test.ts`, `tests/integration/build.test.ts:368`

**Interfaces:**
- Produces: `AcceptanceResult["result"]` is `"pass" | "fail" | "flaky" | "none" | "skipped" | "fixed"`. `result.json` `patches[].acceptance` uses `"none"` for a patch without a check. Task 2 relies on this value.

- [ ] **Step 1: Update the failing tests**

In `tests/integration/acceptance.test.ts`, first test:

```ts
expect(results(w)).toEqual({ good: "pass", plain: "none" });
expect(result.out).not.toContain("unverified");
expect(result.out).not.toContain("no acceptance check");
expect(read(join(latest(w), "report.md"))).toContain("## Acceptance checks\n\n- good: pass\n\n");
```

Second test: `expect(results(w)).toMatchObject({ good: "none", bad: "fail", other: "pass" });`

Add a test `"a build where no patch has an acceptance check has no acceptance section in the report"`: one branch `plain`, `configure(w, ["plain"])`, `build` exits 0, `results(w)` equals `{ plain: "none" }`, and `report.md` does not contain `"## Acceptance checks"`.

In `tests/integration/build.test.ts:368`: `acceptance: "none"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/integration/acceptance.test.ts tests/integration/build.test.ts`
Expected: FAIL on the `"none"` and report assertions.

- [ ] **Step 3: Implement**

- Type and `accept.ts`: rename the value.
- `report.ts` `acceptanceRows`: fallback `p.acceptance ? "not run" : "none"`; update the doc comment to say `none` without one. In `result()`, `acceptance.get(p.display) ?? "none"`.
- `report.ts` report body: the "Acceptance checks" section lists only rows whose plan entry has a check (`run.plan.find(p => p.display === a.patch)?.acceptance`), and is omitted entirely when that list is empty (`section()` would print `none` for an empty list, so guard with a conditional spread).
- `finish.ts`: remove the conditional `unverified:` line.
- `render.ts`: `case "none":`.
- Docs: replace "unverified" wording. FR-030 becomes: patches without an acceptance check MUST NOT fail the run and are reported with acceptance `none` in `result.json`; human-facing output does not mark them. Scenario 3: that patch is reported as `none` in `result.json` and the run is not failed for it. Data model: `"unverified"` to `"none"` in the unions; drop `unverified` from the events example list. Quickstart: `none` for the second. README line 105: "Patches with a check are marked `(with check)` in `list`."

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run typecheck && bun test tests/integration/acceptance.test.ts tests/integration/build.test.ts`
Expected: no type errors, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/runstate.ts src/run/accept.ts src/run/finish.ts src/report/report.ts src/live/render.ts tests/integration/acceptance.test.ts tests/integration/build.test.ts specs/001-standalone-patch-build-tool README.md
git commit -m "feat(acceptance): report patches without a check as none, not unverified"
```

### Task 2: `list` marks patches with a check; `status` shows `-`

**Files:**
- Modify: `src/views/list.ts:56`
- Modify: `src/cli/commands/status.ts:123`
- Modify: `src/views/status.ts:133,156`
- Modify docs: `specs/001-standalone-patch-build-tool/contracts/cli.md:11` ("pinned and with-check marks")
- Test: `tests/integration/patchlist.test.ts:60-68`, `tests/integration/status.test.ts:103-113`

**Interfaces:**
- Consumes: `result.json` acceptance value `"none"` (Task 1).
- Produces: status row field `acceptance: string | null`, where `"none"` means no check, `null` means a check with no result yet.

- [ ] **Step 1: Update the failing tests**

`patchlist.test.ts`: the three `list` rows lose `(unverified)` (e.g. `"1  acme/widget#109     2026-11-04  jump to blocked agents\n"`). Column widths stay as they are since DESCRIPTION is the last column. Add a test `"list marks a patch with an acceptance check"`: configure two branches, one with `patchExtra: { a: { acceptance: { run: ["true"] }, pin: <sha> } }` (pin via the existing `pin` command if `patchExtra` cannot set it), and assert the `a` row ends with `(pinned <7 chars>) (with check)` and the other row ends with its bare description.

`status.test.ts`:

```ts
expect(text.out).toMatch(/^mine +✓ clean +.* not a PR +2 +pass +- +pinned [0-9a-f]{7}$/m);
expect(text.out).not.toContain("unverified");
// json rows:
["mine", null, true, "none"],
["acme/widget#4", "CLOSED", true, "none"],
```

Add a test `"status reads an older result.json that says unverified as none"`: after a successful `build` of one patch without a check, rewrite `join(latest(w), "result.json")` replacing `"acceptance":"none"` (match the file's real JSON spacing) with `"unverified"`, run `status`: the row's ACCEPTANCE cell is `-`, `status --json` gives `acceptance: "none"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/integration/patchlist.test.ts tests/integration/status.test.ts`
Expected: FAIL on `(unverified)` and `unverified` cells.

- [ ] **Step 3: Implement**

- `list.ts:56`: marker `p.acceptance ? "(with check)" : ""`, kept after the pin marker.
- `commands/status.ts:123`: `acceptance` is the last build's value with legacy `"unverified"` mapped to `"none"`; without a last value, `p.acceptance ? null : "none"`.
- `views/status.ts:133`: cell text `-` when `r.acceptance` is `"none"` or null, tone dim as today. Line 156: delete the hint.
- `contracts/cli.md:11`: update wording.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `bun run typecheck && bun test`
Expected: no type errors, all PASS. Then `rg -n unverified src tests README.md specs/001-standalone-patch-build-tool/{spec,data-model,quickstart}.md specs/001-standalone-patch-build-tool/contracts` prints only the legacy mapping in `src/cli/commands/status.ts` and its test.

- [ ] **Step 5: Commit**

```bash
git add src/views/list.ts src/cli/commands/status.ts src/views/status.ts tests/integration/patchlist.test.ts tests/integration/status.test.ts specs/001-standalone-patch-build-tool/contracts/cli.md
git commit -m "feat(list,status): mark patches with a check, show - for those without"
```

Note: `specs/001-standalone-patch-build-tool/RUNBOOK.md` records past walkthrough results with `unverified`; it is a historical log and stays unchanged.
