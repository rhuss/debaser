import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../core/context";
import { create, type Patch } from "../core/patchlist";
import type { Source } from "../plugins/sources/types";
import { lastBuildOrder, orderChanged } from "./order-note";

const own = (name: string): Source => ({ kind: "branch", name });
const patch = (name: string): Patch => ({ source: own(name), description: name, added: "2026-11-26" });
/** A context whose live list is `names`, with no reports yet. */
function context(names: string[]): Context {
  const dir = mkdtempSync(join(tmpdir(), "debaser-order-note-"));
  return { dir, list: { ...create({ repo: "acme/widget", remote: "upstream", branch: "main" }), patches: names.map(patch) } } as Context;
}
/** A run directory's result.json; `states` maps each patch to its state. */
function report(ctx: Context, stamp: string, r: { command?: string; outcome: string; states: [string, string][] }) {
  const dir = join(ctx.dir, "reports", stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify({ command: r.command ?? "build", outcome: r.outcome, patches: r.states.map(([name, state]) => ({ source: own(name), display: name, state })) }),
  );
}

test("the reference order is the merged patches of the newest successful build", () => {
  const ctx = context(["a", "b", "c"]);
  expect(lastBuildOrder(ctx)).toBeNull();
  expect(orderChanged(ctx)).toBe(false);
  report(ctx, "20261101-100000", { outcome: "success", states: [["a", "merged"], ["b", "skipped-merged"], ["c", "merged"]] });
  expect(lastBuildOrder(ctx)).toEqual(["branch:a", "branch:c"]);
  // A failed or stopped build later on doesn't count; nor does a rebase run.
  report(ctx, "20261102-100000", { outcome: "stopped", states: [["c", "merged"], ["a", "not-merged"]] });
  report(ctx, "20261103-100000", { command: "rebase", outcome: "success", states: [] });
  expect(lastBuildOrder(ctx)).toEqual(["branch:a", "branch:c"]);
  // "rebuild" is what versions before the rename wrote.
  report(ctx, "20261104-100000", { command: "rebuild", outcome: "success", states: [["c", "merged"], ["a", "merged"], ["x", "retired"]] });
  expect(lastBuildOrder(ctx)).toEqual(["branch:c", "branch:a"]);
});

test("only a changed order of the patches that were built gives the note", () => {
  const ctx = context(["a", "b", "c"]);
  report(ctx, "20261101-100000", { outcome: "success", states: [["a", "merged"], ["b", "merged"], ["c", "merged"]] });
  expect(orderChanged(ctx)).toBe(false);
  // Added and retired patches alone change nothing.
  ctx.list!.patches = ["a", "new", "c"].map(patch);
  expect(orderChanged(ctx)).toBe(false);
  ctx.list!.patches = ["new", "a", "b", "c"].map(patch);
  expect(orderChanged(ctx)).toBe(false);
  // A swapped pair does.
  ctx.list!.patches = ["a", "c", "b"].map(patch);
  expect(orderChanged(ctx)).toBe(true);
  ctx.list!.patches = ["c", "new", "a"].map(patch);
  expect(orderChanged(ctx)).toBe(true);
});
