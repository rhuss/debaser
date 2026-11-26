import { expect, test } from "bun:test";
import { display } from "../plugins/sources/parse";
import { Explained, Usage } from "./errors";
import { insertAt, moveTo, type PairResult, type Participant, place, propose, resolveRef, sameOrder, settle } from "./order";
import type { Patch } from "./patchlist";

const repo = "acme/widget";
const patch = (source: Patch["source"]): Patch => ({ source, description: "d", added: "2026-11-26" });
const pr = (number: number, r = repo) => patch({ kind: "pr", repo: r, number });
const own = (name: string) => patch({ kind: "branch", name });
const names = (patches: Patch[]) => patches.map(p => display(p.source));
/** #12, my-branch, other/widget#7, other/widget:topic */
const list = [pr(12), own("my-branch"), pr(7, "other/widget"), patch({ kind: "fork-branch", repo: "other/widget", branch: "topic" })];

const refusal = (f: () => unknown): Error => {
  try {
    f();
  } catch (error) {
    return error as Error;
  }
  throw Error("expected a refusal");
};

test("a bare number is a 1-based position in the live list; outside it is refused with the range", () => {
  expect(resolveRef(list, "1", repo)).toBe(0);
  expect(resolveRef(list, "4", repo)).toBe(3);
  for (const arg of ["0", "5", "12"]) {
    const error = refusal(() => resolveRef(list, arg, repo));
    expect(error).toBeInstanceOf(Explained);
    expect(error.message).toBe(`position ${Number(arg)} is out of range 1..4`);
  }
  // An empty list has no position at all.
  const empty = refusal(() => resolveRef([], "1", repo));
  expect(empty).toBeInstanceOf(Explained);
  expect(empty.message).toContain("position 1 is out of range");
});

test("anything else is a source, read as remove reads it", () => {
  // `#12` is PR 12, never position 12.
  expect(resolveRef(list, "#12", repo)).toBe(0);
  expect(resolveRef(list, "acme/widget#12", repo)).toBe(0);
  expect(resolveRef(list, "ACME/Widget#12", repo)).toBe(0);
  expect(resolveRef(list, "https://github.com/acme/widget/pull/12", repo)).toBe(0);
  expect(resolveRef(list, "my-branch", repo)).toBe(1);
  expect(resolveRef(list, "other/widget#7", repo)).toBe(2);
  expect(resolveRef(list, "https://github.com/other/widget/tree/topic", repo)).toBe(3);
  for (const [arg, shown] of [
    ["#13", "acme/widget#13"],
    ["nope", "nope"],
    ["-1", "-1"],
  ]) {
    const error = refusal(() => resolveRef(list, arg, repo));
    expect(error).toBeInstanceOf(Explained);
    expect(error.message).toBe(`${shown} is not in the list`);
  }
});

test("a source that is only retired is not in the list", () => {
  // Retired patches are not in `patches`, so a reference to one finds nothing.
  const error = refusal(() => resolveRef([pr(12)], "old-branch", repo));
  expect(error.message).toBe("old-branch is not in the list");
});

test("after and before place a patch next to the reference, moving down and up", () => {
  const [a, b, c, d] = list;
  // Down: a after c.
  expect(names(place(list, 0, { after: 2 }))).toEqual(names([b, c, a, d]));
  expect(names(place(list, 0, { before: 2 }))).toEqual(names([b, a, c, d]));
  // Up: d after a, d before a.
  expect(names(place(list, 3, { after: 0 }))).toEqual(names([a, d, b, c]));
  expect(names(place(list, 3, { before: 0 }))).toEqual(names([d, a, b, c]));
  // To the ends.
  expect(names(place(list, 1, { after: 3 }))).toEqual(names([a, c, d, b]));
  // The input stays as it was.
  expect(names(list)).toEqual(names([a, b, c, d]));
});

test("a patch moved relative to itself is a usage error", () => {
  expect(refusal(() => place(list, 1, { after: 1 }))).toBeInstanceOf(Usage);
  expect(refusal(() => place(list, 1, { before: 1 }))).toBeInstanceOf(Usage);
});

test("a move that keeps the order is detected", () => {
  expect(sameOrder(place(list, 1, { after: 0 }), list)).toBe(true);
  expect(sameOrder(place(list, 0, { before: 1 }), list)).toBe(true);
  expect(sameOrder(place(list, 0, { after: 1 }), list)).toBe(false);
  expect(sameOrder(list.slice(0, 3), list)).toBe(false);
  // Same sources, however spelled.
  expect(sameOrder([pr(12, "Acme/Widget")], [pr(12)])).toBe(true);
});

test("a new patch is inserted after or before the reference", () => {
  const [a, b, c, d] = list,
    n = own("new");
  expect(names(insertAt(list, n, { after: 0 }))).toEqual(names([a, n, b, c, d]));
  expect(names(insertAt(list, n, { before: 0 }))).toEqual(names([n, a, b, c, d]));
  expect(names(insertAt(list, n, { after: 3 }))).toEqual(names([a, b, c, d, n]));
  expect(names(insertAt(list, n, { before: 3 }))).toEqual(names([a, b, c, n, d]));
  expect(list).toHaveLength(4);
});

test("moveTo puts the patch at the given final index", () => {
  const [a, b, c, d] = list;
  expect(names(moveTo(list, 3, 0))).toEqual(names([d, a, b, c]));
  expect(names(moveTo(list, 0, 3))).toEqual(names([b, c, d, a]));
  expect(names(moveTo(list, 1, 2))).toEqual(names([a, c, b, d]));
  expect(sameOrder(moveTo(list, 2, 2), list)).toBe(true);
});

/** Participants 0..n-1 (all PRs unless named in `own`), commits unused by the pure sort. */
const joined = (n: number, own: number[] = []): Participant[] =>
  Array.from({ length: n }, (_, index) => ({ index, own: own.includes(index), commit: `c${index}` }));
const pair = (a: number, b: number, ab: boolean, ba: boolean, files = ["x.ts"]): PairResult => ({ a, b, ab, ba, files: ab && ba ? [] : files });
const shown = ["p1", "p2", "p3", "p4", "p5"];

test("rule 1: a patch that merges cleanly only after another goes after it, with a reason", () => {
  // p1 builds on p3: clean as p3, p1 only.
  const p = propose(shown.slice(0, 3), joined(3), [], [pair(0, 2, false, true, ["a.ts"])]);
  expect(p.current).toEqual([0, 1, 2]);
  expect(p.proposed).toEqual([1, 2, 0]);
  expect(p.reasons).toEqual(["#1 p1 after #3 p3: p1 builds on p3 (merged before it, it conflicts in a.ts)"]);
  expect(p.unavoidable).toEqual([]);
  // Already in a working order: nothing moves.
  expect(propose(shown.slice(0, 3), joined(3), [], [pair(0, 2, true, false)]).proposed).toEqual([0, 1, 2]);
});

test("rule 2: an own branch goes after the patch it conflicts with either way; the conflict stays unavoidable", () => {
  const p = propose(shown.slice(0, 3), joined(3, [1]), [], [pair(1, 2, false, false, ["src/x.ts"])]);
  expect(p.proposed).toEqual([0, 2, 1]);
  expect(p.reasons).toEqual(["#2 p2 after #3 p3: both change src/x.ts; p2 is your branch"]);
  expect(p.unavoidable).toEqual([{ a: 1, b: 2, files: ["src/x.ts"] }]);
});

test("both own or neither own: the order is kept and the conflict is unavoidable", () => {
  for (const own of [[], [0, 1]]) {
    const p = propose(shown.slice(0, 2), joined(2, own), [], [pair(0, 1, false, false)]);
    expect(p.proposed).toEqual([0, 1]);
    expect(p.reasons).toEqual([]);
    expect(p.unavoidable).toEqual([{ a: 0, b: 1, files: ["x.ts"] }]);
  }
});

test("a rule 1 cycle drops the constraint that would close it and reports it unavoidable", () => {
  // p1 before p2, p2 before p3, but p3 before p1.
  const p = propose(shown.slice(0, 3), joined(3), [], [pair(0, 1, true, false, ["a"]), pair(1, 2, true, false, ["b"]), pair(0, 2, false, true, ["c"])]);
  // Taken by the patch that goes after: p3 → p1, p1 → p2; p2 → p3 would close the cycle.
  expect(p.proposed).toEqual([2, 0, 1]);
  expect(p.reasons).toEqual([
    "#1 p1 after #3 p3: p1 builds on p3 (merged before it, it conflicts in c)",
    "#2 p2 after #3 p3: p2 builds on #1 p1 in a, which goes after p3",
  ]);
  expect(p.unavoidable).toEqual([{ a: 1, b: 2, files: ["b"] }]);
});

test("rule 1 wins over rule 2 and patches without conflicts keep their relative order", () => {
  // p4 builds on p2; own p1 clashes both ways with p3.
  const p = propose(shown.slice(0, 5), joined(5, [0]), [], [pair(1, 3, true, false), pair(0, 2, false, false, ["y"])]);
  expect(p.proposed).toEqual([1, 2, 0, 3, 4]);
  expect(p.reasons).toEqual(["#1 p1 after #3 p3: both change y; p1 is your branch"]);
});

test("fixed patches keep their place; the participants fill the other slots", () => {
  const p = propose(
    shown.slice(0, 5),
    joined(5).filter(x => x.index !== 1 && x.index !== 3),
    [
      { index: 1, why: "skipped" },
      { index: 3, why: "upstream", files: ["u.ts"] },
    ],
    [pair(0, 4, false, true)],
  );
  expect(p.proposed).toEqual([2, 1, 4, 3, 0]);
  expect(p.skipped).toEqual([1]);
  expect(p.upstream).toEqual([{ index: 3, files: ["u.ts"] }]);
});

test("settle keeps the current order only when the proposal verifies with more conflicts", () => {
  const p = propose(shown.slice(0, 3), joined(3), [], [pair(0, 2, false, true)]);
  const worse = settle(p, { current: 0, proposed: 1 });
  expect(worse.kept).toBe(true);
  expect(worse.proposed).toEqual(worse.current);
  expect(worse.reasons).toEqual([]);
  for (const counts of [
    { current: 1, proposed: 1 },
    { current: 1, proposed: 0 },
  ]) {
    const kept = settle(p, counts);
    expect(kept.kept).toBe(false);
    expect(kept.proposed).toEqual([1, 2, 0]);
    expect(kept.counts).toEqual(counts);
  }
});

test("a rule 2 constraint that contradicts rule 1 constraints is dropped", () => {
  // p2 builds on own p1, p3 on p2; own p1 clashes with p3 either way: p1 can't go after p3.
  const p = propose(shown.slice(0, 3), joined(3, [0]), [], [pair(0, 1, true, false), pair(1, 2, true, false), pair(0, 2, false, false, ["y"])]);
  expect(p.proposed).toEqual([0, 1, 2]);
  expect(p.reasons).toEqual([]);
  expect(p.unavoidable).toEqual([{ a: 0, b: 2, files: ["y"] }]);
});

test("a patch moved behind a later one only through a chain gets a reason naming the chain", () => {
  // p3 builds on p2, and p2 on p4: p2 moves after p4, and p3 follows p2 there.
  const p = propose(shown.slice(0, 4), joined(4), [], [pair(1, 2, true, false, ["c.ts"]), pair(1, 3, false, true, ["b.ts"])]);
  expect(p.proposed).toEqual([0, 3, 1, 2]);
  expect(p.reasons).toEqual([
    "#2 p2 after #4 p4: p2 builds on p4 (merged before it, it conflicts in b.ts)",
    "#3 p3 after #4 p4: p3 builds on #2 p2 in c.ts, which goes after p4",
  ]);
});
