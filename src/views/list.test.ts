import { expect, test } from "bun:test";
import type { Patch } from "../core/patchlist";
import { render } from "./list";

const patch = (name: string): Patch => ({ source: { kind: "branch", name }, description: `about ${name}`, added: "2026-11-26" });
const config = { patches: [patch("a"), patch("b"), patch("c")], retired: [] };
const o = { retired: false, upstream: "upstream/main", fork: null, color: false };

test("a marked row reads >N in the # column, in plain output too", () => {
  const rows = render(config, { ...o, marked: new Set([1]) }).slice(2);
  expect(rows).toEqual([
    "#   PATCH  ADDED       DESCRIPTION",
    "1   a      2026-11-26  about a",
    ">2  b      2026-11-26  about b",
    "3   c      2026-11-26  about c",
  ]);
  // Without marks the column is as before.
  expect(render(config, o)[2]).toBe("#  PATCH  ADDED       DESCRIPTION");
});

test("a marked row is bold on a terminal", () => {
  const rows = render(config, { ...o, color: true, marked: new Set([0]) });
  expect(rows.find(line => line.includes("about a"))).toContain("\x1b[1m>1\x1b[0m");
});
