/** The patch list's order (spec 003): naming a live patch by position or
 * source, placing and moving patches, and the conflict-reducing proposal. Pure. */
import { display, parse, sameSource, sourceKey } from "../plugins/sources/parse";
import { Explained, Usage } from "./errors";
import type { Patch } from "./patchlist";

/** Where a patch goes: next to the patch at this 0-based index. */
export type At = { after: number } | { before: number };

/** The 0-based index of the live patch `arg` names (FR-001, FR-002): a bare
 * number is a 1-based position, anything else a source as `remove` reads it. */
export function resolveRef(patches: Patch[], arg: string, upstreamRepo: string): number {
  if (/^\d+$/.test(arg)) {
    const n = Number(arg);
    if (n < 1 || n > patches.length)
      throw new Explained(patches.length ? `position ${n} is out of range 1..${patches.length}` : `position ${n} is out of range: the list is empty`);
    return n - 1;
  }
  let source;
  try {
    source = parse(arg, upstreamRepo);
  } catch (error) {
    throw new Explained((error as Error).message);
  }
  const index = patches.findIndex(p => sameSource(p.source, source));
  if (index < 0) throw new Explained(`${display(source)} is not in the list`);
  return index;
}

const target = (at: At) => ("after" in at ? at.after : at.before);

/** `patches` with the one at `from` moved next to the one `at` names; the
 * place is taken after removing it, so moving down and up both land beside it. */
export function place(patches: Patch[], from: number, at: At): Patch[] {
  const ref = target(at);
  if (ref === from) throw new Usage("a patch can't be moved relative to itself");
  const rest = patches.filter((_, i) => i !== from),
    i = ref - (ref > from ? 1 : 0);
  rest.splice("after" in at ? i + 1 : i, 0, patches[from]);
  return rest;
}
/** `patches` with the one at `from` moved to the 0-based final index `to`. */
export function moveTo(patches: Patch[], from: number, to: number): Patch[] {
  const rest = patches.filter((_, i) => i !== from);
  rest.splice(to, 0, patches[from]);
  return rest;
}
/** `patches` with `patch` inserted next to the one `at` names. */
export function insertAt(patches: Patch[], patch: Patch, at: At): Patch[] {
  const out = [...patches],
    ref = target(at);
  out.splice("after" in at ? ref + 1 : ref, 0, patch);
  return out;
}
/** Whether both lists hold the same sources in the same order. */
export function sameOrder(a: Patch[], b: Patch[]): boolean {
  return a.length === b.length && a.every((p, i) => sourceKey(p.source) === sourceKey(b[i].source));
}

/** Two patches tested on upstream in both orders (indices a < b, current). */
export type PairResult = { a: number; b: number; ab: boolean; ba: boolean; files: string[] };
/** A patch that takes part in the pair rules. */
export type Participant = { index: number; own: boolean; commit: string };
/** A patch that keeps its place: merged into upstream, or conflicting with upstream alone. */
export type Fixed = { index: number; why: "skipped" | "upstream"; files?: string[] };
export type Constraint = { first: number; then: number; rule: 1 | 2; files: string[] };
export type Proposal = {
  current: number[];
  proposed: number[];
  reasons: string[];
  unavoidable: { a: number; b: number; files: string[] }[];
  upstream: { index: number; files: string[] }[];
  skipped: number[];
  counts: { current: number; proposed: number };
  kept: boolean;
};

/** The conflict-reducing order (FR-015): (1) a patch that merges cleanly only
 * after another goes after it, (2) an own branch goes after a patch it clashes
 * with either way, (3) everything else keeps its relative order. A stable
 * topological sort by current position; fixed patches keep their slots.
 * `names[i]` shows the patch at current index i. */
export function propose(names: string[], participants: Participant[], fixed: Fixed[], pairs: PairResult[]): Omit<Proposal, "counts" | "kept"> {
  const n = names.length,
    own = new Map(participants.map(p => [p.index, p.own])),
    byMover = (x: Constraint, y: Constraint) => x.then - y.then || x.first - y.first,
    builds: Constraint[] = [],
    clashes: Constraint[] = [];
  for (const p of pairs) {
    if (p.ab !== p.ba) builds.push(p.ab ? { first: p.a, then: p.b, rule: 1, files: p.files } : { first: p.b, then: p.a, rule: 1, files: p.files });
    else if (!p.ab && own.get(p.a) !== own.get(p.b))
      clashes.push(own.get(p.a) ? { first: p.b, then: p.a, rule: 2, files: p.files } : { first: p.a, then: p.b, rule: 2, files: p.files });
  }
  // Constraints in priority order; one that closes a cycle is dropped.
  const after = new Map<number, number[]>(participants.map(p => [p.index, []])),
    reaches = (from: number, to: number): boolean => {
      const seen = new Set<number>(),
        todo = [from];
      while (todo.length) {
        const at = todo.pop()!;
        if (at === to) return true;
        if (seen.has(at)) continue;
        seen.add(at);
        todo.push(...(after.get(at) ?? []));
      }
      return false;
    },
    accepted: Constraint[] = [],
    dropped: Constraint[] = [];
  for (const c of [...builds.sort(byMover), ...clashes.sort(byMover)]) {
    if (reaches(c.then, c.first)) dropped.push(c);
    else {
      after.get(c.first)!.push(c.then);
      accepted.push(c);
    }
  }
  // Kahn's sort, always taking the ready patch that is first now.
  const waiting = new Map(participants.map(p => [p.index, 0]));
  for (const c of accepted) waiting.set(c.then, waiting.get(c.then)! + 1);
  const sorted: number[] = [];
  while (waiting.size) {
    const next = Math.min(...[...waiting].filter(([, count]) => count === 0).map(([index]) => index));
    waiting.delete(next);
    sorted.push(next);
    for (const then of after.get(next)!) waiting.set(then, waiting.get(then)! - 1);
  }
  const taking = new Set(participants.map(p => p.index)),
    current = Array.from({ length: n }, (_, i) => i),
    proposed = current.map(i => (taking.has(i) ? sorted.shift()! : i)),
    shown = (i: number) => `#${i + 1} ${names[i]}`,
    direct = accepted.filter(c => c.then < c.first),
    at = new Map(proposed.map((index, slot) => [index, slot])),
    // A patch can also move behind a later one only through a chain: it waits
    // for a patch it goes after, which itself went behind that later one.
    chained = participants.flatMap(({ index: x }) => {
      if (direct.some(c => c.then === x)) return [];
      const passed = participants.filter(({ index: y }) => y > x && at.get(y)! < at.get(x)!).map(p => p.index),
        waits = accepted.filter(c => c.then === x);
      if (!passed.length || !waits.length) return [];
      const y = passed.reduce((a, b) => (at.get(a)! > at.get(b)! ? a : b)),
        via = waits.reduce((a, b) => (at.get(a.first)! > at.get(b.first)! ? a : b));
      return [`${shown(x)} after ${shown(y)}: ${names[x]} ${via.rule === 1 ? "builds on" : "is your branch and clashes with"} ${shown(via.first)}${via.files.length ? ` in ${via.files.join(", ")}` : ""}, which goes after ${names[y]}`];
    }),
    reasons = [
      ...direct.map(c =>
        c.rule === 1
          ? `${shown(c.then)} after ${shown(c.first)}: ${names[c.then]} builds on ${names[c.first]}${c.files.length ? ` (merged before it, it conflicts in ${c.files.join(", ")})` : ""}`
          : `${shown(c.then)} after ${shown(c.first)}: both change ${c.files.join(", ")}; ${names[c.then]} is your branch`,
      ),
      ...chained,
    ],
    unavoidable = [
      ...pairs.filter(p => !p.ab && !p.ba).map(p => ({ a: p.a, b: p.b, files: p.files })),
      ...dropped.filter(c => c.rule === 1).map(c => ({ a: Math.min(c.first, c.then), b: Math.max(c.first, c.then), files: c.files })),
    ].sort((x, y) => x.a - y.a || x.b - y.b);
  return {
    current,
    proposed,
    reasons,
    unavoidable,
    upstream: fixed.filter(f => f.why === "upstream").map(f => ({ index: f.index, files: f.files ?? [] })),
    skipped: fixed.filter(f => f.why === "skipped").map(f => f.index),
  };
}
/** The proposal with its verified conflict counts (FR-016): one that merges
 * with more conflicts than the current order is not proposed. */
export function settle(p: Omit<Proposal, "counts" | "kept">, counts: Proposal["counts"]): Proposal {
  const kept = counts.proposed > counts.current;
  return { ...p, counts, kept, ...(kept ? { proposed: [...p.current], reasons: [] } : {}) };
}
