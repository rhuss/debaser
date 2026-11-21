import { expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import {
  branch,
  commit,
  configure,
  conflicting,
  fixBroken,
  git,
  handoffs,
  latest,
  read,
  run,
  stubHarness,
  takeTheirs,
  upstreamMoves,
  withStep,
  write,
  world,
} from "../support/world";

setDefaultTimeout(120_000);

const rule = "never into the integration branch";
const clashing = withStep("typecheck", {
  run: ["sh", "-c", 'test -f ok.txt || ! { test -f a.txt && test -f b.txt; } || { echo "a.txt clashes with b.txt"; false; }'],
});

test("a patch that conflicts with upstream is reported for a rebase with a handoff", async () => {
  const w = world();
  branch(w, "stale", { "base.txt": "one\nSTALE\nthree\n" });
  upstreamMoves(w, { "base.txt": "one\nUPSTREAM\nthree\n" });
  configure(w, ["stale"], { harness: { command: stubHarness(takeTheirs).command } });
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  const text = read(join(latest(w), "report.md"));
  expect(text).toContain("## Needs a rebase onto upstream\n\n- stale: base.txt\n");
  expect(text).toContain("## Agent-resolved merges\n\n- stale: base.txt\n");
  expect(text).toContain("## Clashes between patches\n\nnone\n");
  expect(handoffs(w)).toEqual(["stale.md"]);
  const handoff = read(join(latest(w), "handoffs", "stale.md"));
  expect(handoff).toContain("# Handoff: stale\n");
  expect(handoff).toContain("- Kind: rebase\n");
  expect(handoff).toContain("- base.txt");
  expect(handoff).toContain("upstream main moved on");
  expect(handoff).toContain("Run this in the checkout of branch stale:");
  expect(handoff).toContain(rule);
  expect(result.out).toContain("handoff: ");
});

test("patches that only clash with each other get a note and no handoff, however resolved", async () => {
  const byHarness = world();
  conflicting(byHarness);
  configure(byHarness, ["left", "right"], { harness: { command: stubHarness(takeTheirs).command } });
  expect((await run(byHarness, "rebuild")).code).toBe(0);
  expect(read(join(latest(byHarness), "report.md"))).toContain(
    "## Clashes between patches\n\n- right conflicted with left in base.txt (resolved by harness); it merges cleanly onto upstream alone\n",
  );
  expect(handoffs(byHarness)).toEqual([]);

  const byUser = world();
  conflicting(byUser);
  configure(byUser, ["left", "right"]);
  expect((await run(byUser, "rebuild")).code).toBe(2);
  expect(read(join(latest(byUser), "report.md"))).toContain("(resolved by nobody yet)");
  write(byUser.clone, { "base.txt": "one\nBOTH\nthree\n" });
  git(byUser.clone, "add", "base.txt");
  expect((await run(byUser, "continue")).code).toBe(0);
  expect(read(join(latest(byUser), "report.md"))).toContain("in base.txt (resolved by user)");
  expect(handoffs(byUser)).toEqual([]);
});

test("an agent fix for a patch that fails alone on upstream hands off build drift to that patch", async () => {
  const w = world();
  branch(w, "fine", { "fine.txt": "fine\n" });
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["fine", "bad"], { harness: { command: stubHarness(fixBroken).command } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(handoffs(w)).toEqual(["bad.md"]);
  const handoff = read(join(latest(w), "handoffs", "bad.md"));
  expect(handoff).toContain("- Kind: build-drift\n");
  expect(handoff).toContain("debaser: fix typecheck (agent)");
  expect(handoff).toContain("bad.txt");
  expect(handoff).toContain(rule);
  const text = read(join(latest(w), "report.md"));
  expect(text).toMatch(/## Fix commits\n\n- [0-9a-f]{7} typecheck \(agent\): bad\.txt\n/);
  expect(text).toContain("- typecheck: passed after a fix");
  expect(text).toContain("- build: passed");
});

test("an agent fix for patches that only fail together hands off a clash naming each other", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  configure(w, ["a", "b"], { steps: clashing, harness: { command: stubHarness("echo ok > ok.txt").command } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(handoffs(w)).toEqual(["a.md", "b.md"]);
  const a = read(join(latest(w), "handoffs", "a.md")),
    b = read(join(latest(w), "handoffs", "b.md"));
  expect(a).toContain("- Kind: build-clash\n");
  expect(a).toContain("clashes with: b");
  expect(b).toContain("clashes with: a");
  for (const text of [a, b]) expect(text).toContain(rule);
});

test("an agent fix touching a single patch that passes alone names the other merged patches as its clash", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  // Fails with both merged; the output names only a.txt, so only a is implicated.
  const steps = withStep("typecheck", { run: ["sh", "-c", 'test -f ok.txt || test "$(ls [ab].txt 2>/dev/null | wc -l)" -lt 2 || { echo "a.txt broke"; false; }'] });
  configure(w, ["a", "b"], { steps, harness: { command: stubHarness("echo ok > ok.txt").command } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(handoffs(w)).toEqual(["a.md"]);
  expect(read(join(latest(w), "handoffs", "a.md"))).toContain("clashes with: b");
});

test("an agent fix that no patch is named for runs nothing to attribute it and hands off nothing", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  // A test runner's file list names every patch's file; the failure names none.
  const steps = withStep("typecheck", { run: ["sh", "-c", 'printf "a.txt:\\nb.txt:\\n"; test -f ok.txt || ! test -f a.txt'] });
  configure(w, ["a", "b"], { steps, harness: { command: stubHarness("echo ok > ok.txt").command } });
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(result.err).toContain("the typecheck fix changed or the failure names; not attributed");
  expect(result.err).not.toContain("alone on upstream (");
  expect(handoffs(w)).toEqual([]);
  expect(read(join(latest(w), "report.md"))).toMatch(/typecheck \(agent\): ok\.txt \(no merged patch .*; no handoff\)/);
});

test("attribution says which patch it runs alone and how many are left", async () => {
  const w = world();
  branch(w, "fine", { "fine.txt": "fine\n" });
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["fine", "bad"], { harness: { command: stubHarness(fixBroken).command } });
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(result.err).toContain("running typecheck with bad alone on upstream (1 of 1, 0 left)");
});

test("a stopped and continued run keeps one set of handoffs", async () => {
  const w = world();
  branch(w, "stale", { "base.txt": "one\nSTALE\nthree\n" });
  commit(w.seed, { "base.txt": "one\nUPSTREAM\nthree\n" }, "upstream moves on");
  git(w.seed, "push", "-q", "origin", "main");
  configure(w, ["stale"]);
  expect((await run(w, "rebuild")).code).toBe(2);
  expect(handoffs(w)).toEqual(["stale.md"]);
  write(w.clone, { "base.txt": "one\nBOTH\nthree\n" });
  git(w.clone, "add", "base.txt");
  expect((await run(w, "continue")).code).toBe(0);
  expect(handoffs(w)).toEqual(["stale.md"]);
});

test("a patch gets one handoff per run, holding every problem it has", async () => {
  const w = world();
  branch(w, "stale", { "base.txt": "one\nSTALE\nthree\n", "stale.txt": "BROKEN\n" });
  upstreamMoves(w, { "base.txt": "one\nUPSTREAM\nthree\n" });
  const h = stubHarness(`if [ "$DEBASER_TASK" = conflict ]; then\n${takeTheirs}\nelse\n${fixBroken}\nfi`);
  configure(w, ["stale"], { harness: { command: h.command } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(handoffs(w)).toEqual(["stale.md"]);
  const handoff = read(join(latest(w), "handoffs", "stale.md"));
  expect(handoff).toContain("- Kind: rebase, build-clash\n");
  expect(handoff).toContain("1. (rebase)");
  expect(handoff).toContain("2. (build-clash)");
});
