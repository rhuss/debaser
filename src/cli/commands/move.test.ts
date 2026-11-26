import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../../core/context";
import type { Proposal } from "../../core/order";
import { create, save, type Patch } from "../../core/patchlist";
import type { IO } from "../main";
import { proposed } from "./move";

const patch = (name: string): Patch => ({ source: { kind: "branch", name }, description: name, added: "2026-11-26" });

test("a proposal that verifies with more conflicts keeps the current order, even with --yes, and still shows what no order avoids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-move-")),
    list = { ...create({ repo: "acme/widget", remote: "upstream", branch: "main" }), patches: ["a", "b", "c"].map(patch) };
  save(dir, list);
  const was = readFileSync(join(dir, "patches.json"), "utf8"),
    ctx = { dir, list, line: async () => "y" } as unknown as Context,
    io = { out: () => {}, err: () => {} } as unknown as IO,
    // The pure ordering moved c first, but merging that order conflicted more (FR-016).
    proposal: Proposal = {
      current: [0, 1, 2],
      proposed: [0, 1, 2],
      reasons: [],
      unavoidable: [{ a: 0, b: 1, files: ["x.ts"] }],
      upstream: [{ index: 2, files: ["u.ts"] }],
      skipped: [],
      counts: { current: 1, proposed: 2 },
      kept: true,
    },
    compute = () => ({ proposal, names: ["a", "b", "c"] });
  for (const yes of [true, false]) {
    const r = await proposed(ctx, { fetch: false, yes }, io, compute);
    expect(r.code).toBe(0);
    expect(r.lines.at(-1)).toBe("the proposed order merges with more conflicts than the current one; the current order stays");
    expect(r.lines).toContain("    a and b: x.ts");
    expect(r.lines).toContain("    c: u.ts");
    expect(r.lines).toContain("  conflicts: current order 1, proposed order 2");
    expect(readFileSync(join(dir, "patches.json"), "utf8")).toBe(was);
  }
});
