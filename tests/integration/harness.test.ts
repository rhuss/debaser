import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveEvent } from "../../src/live/events";
import { buildLeftover } from "../../src/run/leftover";
import {
  argv,
  branch,
  claudeStream,
  commit,
  configure,
  conflicting,
  fixBroken,
  fresh,
  git,
  head,
  interruptHarness,
  keepArgs,
  latest,
  handoffs,
  noGh,
  pullRequest,
  read,
  run,
  runWith,
  stamped,
  state,
  stubHarness,
  stubSteps,
  takeTheirs,
  withStep,
  write,
  world,
} from "../support/world";

setDefaultTimeout(120_000);

const clashing = withStep("typecheck", {
  run: ["sh", "-c", 'test -f ok.txt || ! { test -f a.txt && test -f b.txt; } || { echo "a.txt clashes with b.txt"; false; }'],
});

test("a harness resolution that passes the checks is committed with a trailer", async () => {
  const w = world();
  conflicting(w);
  const h = stubHarness(
    `cp "$1" "$(dirname "$0")/prompt-file"; echo "$DEBASER_PROMPT" > "$(dirname "$0")/prompt-env"; cat > "$(dirname "$0")/stdin"; echo "$DEBASER_TASK" > "$(dirname "$0")/kind"; cp .git/debaser/run.json "$(dirname "$0")/run.json"\n${takeTheirs}`,
  );
  configure(w, ["left", "right"], { harness: { command: h.command } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(1);
  expect(read(join(w.clone, "base.txt"))).toBe("one\nRIGHT\nthree\n");
  expect(git(w.clone, "log", "-1", "--format=%B", "HEAD^{/Merge right}")).toBe("Merge right: about right\n\nResolved-By: harness");
  const prompt = read(join(h.bin, "prompt-file"));
  // The prompt is a file named in the command and in DEBASER_PROMPT; stdin is closed.
  expect(read(join(h.bin, "stdin"))).toBe("");
  expect(read(read(join(h.bin, "prompt-env")).trim())).toBe(prompt);
  expect(read(join(h.bin, "kind"))).toBe("conflict\n");
  // While it ran, the run recorded the call; afterwards the marker is gone.
  expect(JSON.parse(read(join(h.bin, "run.json"))).harnessCall).toMatchObject({ kind: "conflict", patch: "right", attempt: 1, files: ["base.txt"] });
  expect(prompt).toContain("- Patch: right");
  expect(prompt).toContain("- base.txt");
  expect(prompt).toContain("- left: about left");
  expect(prompt).toContain("- Description: about right");
  expect(prompt).toContain("- Pull request: none");
  expect(prompt).toContain("Resolve the conflicts in the files listed above.");
  expect(prompt).toContain("patched widget build");
  expect(result.out).toContain("agent resolved the conflict in right");
});

test("harness resolutions with markers, extra edits, commits or timeouts are rejected until attempts run out", async () => {
  const cases: [string, string, { timeoutSeconds?: number }, RegExp][] = [
    ["leaves markers", "true", {}, /conflict markers remain in base\.txt/],
    ["edits another file", `${takeTheirs}\necho changed > package.json`, {}, /outside the conflict: package\.json/],
    ["commits", `${takeTheirs}\ngit add -A && git commit -q -m mine`, {}, /it committed/],
    ["times out", "exec sleep 10", { timeoutSeconds: 1 }, /timed out after 1s/],
  ];
  for (const [name, body, limits, why] of cases) {
    const w = world();
    conflicting(w);
    const h = stubHarness(body);
    configure(w, ["left", "right"], { harness: { command: h.command, attempts: 2, ...limits } });
    const started = performance.now();
    const result = await run(w, "build");
    // Rejected for the reason the case is about, not some other one.
    const reasons = (state(w)?.harnessUsage ?? []).map(u => u.reason ?? "");
    expect([name, reasons.length, reasons.every(r => why.test(r))]).toEqual([name, 2, true]);
    // Two attempts of a 10s sleep end well before 20s when the timeout holds.
    if (limits.timeoutSeconds) expect(performance.now() - started).toBeLessThan(15_000);
    expect([name, result.code]).toEqual([name, 5]);
    expect([name, h.calls()]).toEqual([name, 2]);
    expect(result.out).toContain("rollback");
    // The conflict is back in place for the user.
    expect([name, git(w.clone, "diff", "--name-only", "--diff-filter=U")]).toEqual([name, "base.txt"]);
    expect(read(join(w.clone, "package.json"))).toBe("{}\n");
    expect(state(w)?.phase).toBe("merge");
  }
});

test("a harness that can't be run is a warning, and the run stops as without one", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"], { harness: { command: ["/nonexistent/harness", "{prompt_file}"] } });
  const result = await run(w, "build");
  expect(result.code).toBe(2);
  expect(result.err).toContain("warning: harness /nonexistent/harness is not executable");
  const v = world();
  branch(v, "bad", { "bad.txt": "BROKEN\n" });
  configure(v, ["bad"], { harness: { command: ["/nonexistent/harness", "{prompt_file}"] } });
  expect((await run(v, "build")).code).toBe(3);
});

test("a harness build fix becomes its own commit and the steps rerun; the next build drops it", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const h = stubHarness(`echo "$DEBASER_TASK" > "$(dirname "$0")/kind"; cp "$1" "$(dirname "$0")/prompt-file"\n${fixBroken}`);
  configure(w, ["bad"], { harness: { command: h.command } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(read(join(h.bin, "kind"))).toBe("check\n");
  const prompt = read(join(h.bin, "prompt-file"));
  expect(prompt).toContain("- Step: typecheck");
  expect(prompt).toContain("- Command: `sh -c ! grep -rqs BROKEN --include=*.txt .`");
  expect(prompt).toContain("- bad: about bad");
  expect(prompt).toContain("$ sh -c ! grep -rqs BROKEN");
  expect(prompt).toContain("Leave your changes in the working tree. Do not commit, amend or rebase.");
  expect(git(w.clone, "log", "-1", "--format=%B")).toBe("debaser: fix typecheck (agent)\n\nFixed-By: harness");
  expect(stamped(w).map(p => p.source)).toEqual(["bad"]);
  expect(result.out).toContain("agent fix");
  expect(git(w.clone, "status", "--porcelain")).toBe("");
  // Rebuilding starts from upstream again: the old fix is gone, a new one is made.
  expect((await run(w, "build")).code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(git(w.clone, "log", "--first-parent", "--format=%s", "upstream/main..HEAD").split("\n")).toEqual([
    "debaser: fix typecheck (agent)",
    "Merge bad: about bad",
  ]);
});

test("a harness that changes nothing exhausts its attempts; upstream breakage never calls it", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const idle = stubHarness("true");
  configure(w, ["bad"], { harness: { command: idle.command, attempts: 2 } });
  const result = await run(w, "build");
  expect(result.code).toBe(5);
  expect(idle.calls()).toBe(2);
  expect(state(w)?.step).toBe("typecheck");

  const u = world();
  commit(u.seed, { "upstream.txt": "BROKEN\n" }, "upstream breaks");
  git(u.seed, "push", "-q", "origin", "main");
  branch(u, "fine", { "fine.txt": "fine\n" }, "main");
  const unused = stubHarness(fixBroken);
  configure(u, ["fine"], { harness: { command: unused.command } });
  expect((await run(u, "build")).code).toBe(4);
  expect(unused.calls()).toBe(0);
});

test("a claude harness logs readable text, keeps the raw stream and records tokens", async () => {
  const w = world();
  conflicting(w);
  const h = stubHarness(`${keepArgs}\n${takeTheirs}\n${claudeStream}`);
  configure(w, ["left", "right"], { harness: { command: h.command, kind: "claude" } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  const log = read(join(latest(w), "prompts", "01-conflict.log"));
  expect(log).toContain("Keeping both import blocks.");
  expect(log).not.toContain('"type":"assistant"');
  expect(read(join(latest(w), "prompts", "01-conflict.jsonl"))).toContain('"type":"result"');
  expect(argv(h).slice(-3)).toEqual(["--output-format", "stream-json", "--verbose"]);
  expect(read(join(latest(w), "report.md"))).toContain(
    "## Harness\n\n- 1 call, 1 accepted, tokens 51.0k in / 7.4k out\n- right conflict try 1: accepted, 51.0k in / 7.4k out\n",
  );
  expect(JSON.parse(read(join(latest(w), "result.json"))).harness).toEqual({ calls: 1, tokens: { input: 51000, output: 7400 } });
});

test("plain run with kind claude shows readable text", async () => {
  const w = world();
  conflicting(w);
  const h = stubHarness(`${takeTheirs}\n${claudeStream}`);
  configure(w, ["left", "right"], { harness: { command: h.command, kind: "claude" } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(result.err).toContain("Keeping both import blocks.\n");
  expect(result.err).not.toContain('{"type"');
  expect(result.err).not.toContain("\x1b");
});

test("a claude harness's activity reaches the sink, and a sink that throws on it stops nothing", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"], { harness: { command: stubHarness(`${takeTheirs}\n${claudeStream}`).command, kind: "claude" } });
  const events: LiveEvent[] = [];
  const result = await runWith(
    w,
    {
      sink: e => {
        events.push(e);
        if (e.t === "harness" && e.state === "activity") throw Error("broken view");
      },
    },
    "build",
  );
  expect(result.code).toBe(0);
  expect(events[0]).toMatchObject({ t: "begin", harness: "claude" });
  const activity = events.filter(e => e.t === "harness" && e.state === "activity");
  expect(activity.length).toBeGreaterThan(0);
  expect(activity[0]).toMatchObject({ stage: "merge", id: "right", attempt: 1, limit: 3 });
  expect(activity.map(e => (e as { text?: string }).text)).toContain("Keeping both import blocks.");
  expect(read(join(latest(w), "prompts", "01-conflict.log"))).toContain("Keeping both import blocks.");
  expect(events.find(e => e.t === "harness" && e.state === "end")).toMatchObject({ ok: true, usage: { input: 51000, output: 7400 } });
});

test("a harness without kind is run and logged as today", async () => {
  const w = world();
  conflicting(w);
  const h = stubHarness(`${keepArgs}\n${takeTheirs}\necho plain words`);
  configure(w, ["left", "right"], { harness: { command: h.command } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(argv(h)).not.toContain("--output-format");
  expect(existsSync(join(latest(w), "prompts", "01-conflict.jsonl"))).toBe(false);
  expect(read(join(latest(w), "prompts", "01-conflict.log"))).toContain("plain words\n");
  expect(result.err).toContain("plain words\n");
  expect(read(join(latest(w), "report.md"))).toContain(
    "## Harness\n\n- 1 call, 1 accepted, tokens unknown\n- right conflict try 1: accepted, tokens unknown\n",
  );
});

test("rejected fixes are recorded as harness calls", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["bad"], { harness: { command: stubHarness("true").command, attempts: 2 } });
  expect((await run(w, "build")).code).toBe(5);
  expect(state(w)?.harnessUsage?.map(u => [u.call, u.kind, u.step, u.attempt, u.ok, u.reason])).toEqual([
    [1, "check", "typecheck", 1, false, "it changed nothing"],
    [2, "check", "typecheck", 2, false, "it changed nothing"],
  ]);
  expect(read(join(latest(w), "report.md"))).toContain(
    "## Harness\n\n- 2 calls, 0 accepted, tokens unknown\n" +
      "- typecheck fix try 1: rejected: it changed nothing, tokens unknown\n" +
      "- typecheck fix try 2: rejected: it changed nothing, tokens unknown\n",
  );
});

test("a harness that fails to start is asked once, and the stop says why", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  const h = stubHarness('echo "Failed to authenticate: OAuth session expired" >&2; exit 1');
  configure(w, ["a", "b"], { steps: clashing, harness: { command: h.command, attempts: 3 } });
  const stopped = await run(w, "build");
  expect(stopped.code).toBe(5);
  expect(h.calls()).toBe(1);
  expect(stopped.out).toContain("the harness failed to run on typecheck: it exited 1: Failed to authenticate: OAuth session expired");
  expect(stopped.out).toMatch(/harness log: \S+\/prompts\/01-check\.log/);
  expect(stopped.out).toContain("fix the harness, then continue to let it try again");
  // The hint runs the harness as configured: its {prompt_file} names the prompt.
  expect(stopped.out).toMatch(new RegExp(`&& ${h.command[0]} \\S+/fix-typecheck\\.md\\n`));
  expect(read(join(latest(w), "report.md"))).toContain("typecheck fix try 1: rejected: it exited 1: Failed to authenticate: OAuth session expired");
  // Continue asks it again.
  expect((await run(w, "continue")).code).toBe(5);
  expect(h.calls()).toBe(2);
});

test("after a harness fix every step runs again, so a fix can't break a step that passed", async () => {
  const w = world();
  branch(w, "flaky", { "flaky.txt": "FAILTEST\n" });
  // The first fix passes the tests by breaking typecheck; the second fixes typecheck.
  const h = stubHarness("if grep -qs FAILTEST flaky.txt; then echo BROKEN > flaky.txt; else echo fine > flaky.txt; fi");
  configure(w, ["flaky"], { harness: { command: h.command }, steps: withStep("test", { run: ["sh", "-c", "! grep -rqs FAILTEST --include=*.txt ."] }) });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(read(join(w.clone, "flaky.txt"))).toBe("fine\n");
  expect(git(w.clone, "log", "--first-parent", "--format=%s", "upstream/main..HEAD").split("\n")).toEqual([
    "debaser: fix typecheck (agent)",
    "debaser: fix test (agent)",
    "Merge flaky: about flaky",
  ]);
});

test("a second fix for the same step is recorded against the failure it answered", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN-ONE\n" });
  const h = stubHarness("if grep -qs BROKEN-ONE bad.txt; then echo BROKEN-TWO > bad.txt; else echo fine > bad.txt; fi");
  configure(w, ["bad"], { harness: { command: h.command }, steps: withStep("typecheck", { run: ["sh", "-c", "! grep -rhs BROKEN --include=*.txt ."] }) });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  const first = read(join(latest(w), "steps", "typecheck-failed-1.log")),
    second = read(join(latest(w), "steps", "typecheck-failed-2.log"));
  expect(first).toContain("BROKEN-ONE");
  expect(second).toContain("BROKEN-TWO");
  expect(second).not.toContain("BROKEN-ONE");
});

test("a fix for every step within one attempt each still finishes the run", async () => {
  const w = world();
  branch(w, "four", { "a.txt": "INSTALLX\n", "b.txt": "BROKEN\n", "c.txt": "FAILTEST\n", "d.txt": "BUILDX\n" });
  const fails = (marker: string, then = "true") => ["sh", "-c", `! grep -rqs ${marker} --include=*.txt . && ${then}`];
  // Each call repairs the first marker left, which is the one the failing step checks.
  const h = stubHarness(
    'for m in INSTALLX BROKEN FAILTEST BUILDX; do f=$(grep -rls --include=*.txt "$m" . | head -1); if [ -n "$f" ]; then echo fine > "$f"; exit 0; fi; done',
  );
  configure(w, ["four"], {
    harness: { command: h.command, attempts: 1 },
    steps: [
      { name: "install", run: fails("INSTALLX") },
      { name: "typecheck", run: fails("BROKEN") },
      { name: "test", run: fails("FAILTEST") },
      { name: "build", run: ["sh", "-c", '! grep -rqs BUILDX --include=*.txt . && mkdir -p "$(dirname "$1")" && touch "$1"', "build", "{output}"] },
    ],
  });
  const result = await run(w, "build");
  expect(result.err).not.toContain("debaser: cannot");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(4);
});

test("fixes that keep breaking each other stop at the fix bound with exit 5", async () => {
  const w = world();
  branch(w, "toggle", { "toggle.txt": "BROKEN\n" });
  // Each fix trades one failure for the other.
  const h = stubHarness("if grep -qs BROKEN toggle.txt; then echo FAILTEST > toggle.txt; else echo BROKEN > toggle.txt; fi");
  configure(w, ["toggle"], { harness: { command: h.command, attempts: 1 }, steps: withStep("test", { run: ["sh", "-c", "! grep -rqs FAILTEST --include=*.txt ."] }) });
  const result = await run(w, "build");
  expect(result.code).toBe(5);
  // One attempt per problem, four steps, no acceptance checks: four fixes at most.
  expect(h.calls()).toBe(4);
  expect(result.out).toContain("after the harness's 4 fixes");
});

test("after a fix the earlier steps run again before the failing one is judged", async () => {
  const w = world();
  branch(w, "src", { "src.txt": "BROKEN\n" });
  // native builds from src.txt; test checks what native built.
  const h = stubHarness("echo fine > src.txt");
  configure(w, ["src"], {
    harness: { command: h.command, attempts: 2 },
    install: null,
    artifact: null,
    steps: [
      { name: "native", run: ["sh", "-c", "if [ -f src.txt ]; then cp src.txt native.out; fi"] },
      { name: "test", run: ["sh", "-c", "! grep -qs BROKEN native.out"] },
    ],
  });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(1);
  expect(result.err).toContain("running native again before test");
});

test("the fix bound holds inside one problem's attempts, not only between problems", async () => {
  const w = world();
  branch(w, "count", { "patched.txt": "x\n" });
  // Each fix bumps count.txt: a passes only at 2, b fails only at 2, so after
  // three fixes a fails again with one fix left under the bound of 2 x 2.
  const count = 'c=$(cat count.txt 2>/dev/null || echo 0)';
  const h = stubHarness(`${count}; echo $((c+1)) > count.txt`);
  configure(w, ["count"], {
    harness: { command: h.command, attempts: 2 },
    install: null,
    artifact: null,
    steps: [
      { name: "a", run: ["sh", "-c", `test ! -f patched.txt || { ${count}; [ "$c" -eq 2 ]; }`] },
      { name: "b", run: ["sh", "-c", `test ! -f patched.txt || { ${count}; [ "$c" -ne 2 ]; }`] },
    ],
  });
  const result = await run(w, "build");
  expect(result.code).toBe(5);
  expect(h.calls()).toBe(4);
  expect(result.out).toContain("a fails again after the harness's 4 fixes");
});

test("the harness for each task comes from its own setting, else the default", async () => {
  const w = world();
  conflicting(w);
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const conflictHarness = stubHarness(takeTheirs),
    checkHarness = stubHarness(fixBroken),
    fallback = stubHarness("true");
  configure(w, ["left", "right", "bad"], {
    harness: { command: fallback.command, tasks: { conflict: { command: conflictHarness.command }, check: { command: checkHarness.command } } },
  });
  expect((await run(w, "build")).code).toBe(0);
  expect([conflictHarness.calls(), checkHarness.calls(), fallback.calls()]).toEqual([1, 1, 0]);
  const v = world();
  branch(v, "bad", { "bad.txt": "BROKEN\n" });
  const only = stubHarness(fixBroken);
  configure(v, ["bad"], { harness: { command: only.command, tasks: { conflict: { command: ["/nonexistent"] } } } });
  expect((await run(v, "build")).code).toBe(0);
  expect(only.calls()).toBe(1);
});

test("a recorded resolution replays before any harness is called", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  write(w.clone, { "base.txt": "one\nBOTH\nthree\n" });
  git(w.clone, "add", "base.txt");
  expect((await run(w, "continue")).code).toBe(0);
  const h = stubHarness(takeTheirs);
  configure(w, ["left", "right"], { harness: { command: h.command } });
  expect((await run(w, "build")).code).toBe(0);
  expect(h.calls()).toBe(0);
  expect(read(join(w.clone, "base.txt"))).toBe("one\nBOTH\nthree\n");
  expect(read(join(latest(w), "report.md"))).toContain("in base.txt (resolved by rerere)");
});

test("a harness retry keeps the files rerere replayed staged, so a later attempt can pass", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  write(w.clone, { "base.txt": "one\nBOTH\nthree\n" });
  git(w.clone, "add", "base.txt");
  expect((await run(w, "continue")).code).toBe(0);
  // Now right also conflicts in a file rerere knows nothing about.
  for (const [name, text] of [
    ["left", '{"left":1}\n'],
    ["right", '{"right":1}\n'],
  ]) {
    git(w.clone, "checkout", "-q", name);
    commit(w.clone, { "package.json": text });
  }
  git(w.clone, "checkout", "-q", "debaser");
  // The first attempt leaves the markers in; the second resolves.
  const h = stubHarness(`[ "$(wc -l < "$(dirname "$0")/calls")" -ge 2 ] || exit 0\n${takeTheirs}`);
  configure(w, ["left", "right"], { harness: { command: h.command, attempts: 2 } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(read(join(w.clone, "base.txt"))).toBe("one\nBOTH\nthree\n");
  expect(read(join(w.clone, "package.json"))).toBe('{"right":1}\n');
});

test("the conflict prompt for a PR carries its link and description", async () => {
  const w = world();
  branch(w, "left", { "base.txt": "one\nLEFT\nthree\n" });
  pullRequest(w, "acme/widget", 8, { "base.txt": "one\nPR\nthree\n" });
  noGh(w);
  const h = stubHarness(`cp "$1" "$(dirname "$0")/prompt-file"\n${takeTheirs}`);
  configure(w, ["left", "#8"], { harness: { command: h.command } });
  expect((await run(w, "build")).code).toBe(0);
  const prompt = read(join(h.bin, "prompt-file"));
  expect(prompt).toContain("- Patch: acme/widget#8");
  expect(prompt).toContain("- Description: about #8");
  expect(prompt).toContain("- Pull request: https://github.com/acme/widget/pull/8");
});

test("a harness that times out takes its children with it", async () => {
  const w = world();
  conflicting(w);
  // The harness and its background child hold a FIFO open; its reader sees the end only once both are gone.
  const fifo = join(fresh("fifo"), "held");
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
  const reader = Bun.spawn(["cat", fifo], { stdout: "ignore" }),
    h = stubHarness(`exec 3>"${fifo}"\n(exec sleep 30) &\nexec sleep 30`);
  configure(w, ["left", "right"], { harness: { command: h.command, attempts: 1, timeoutSeconds: 1 } });
  try {
    expect((await run(w, "build")).code).toBe(5);
    const gone = await Promise.race([reader.exited.then(() => true), new Promise<boolean>(resolve => setTimeout(resolve, 5000, false))]);
    expect(gone).toBe(true);
  } finally {
    reader.kill();
  }
});

test("a fix never commits the temporary files a build leaves", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const h = stubHarness(`${fixBroken}\necho junk > .0123abcd-00000000.bun-build`);
  configure(w, ["bad"], { harness: { command: h.command } });
  expect((await run(w, "build")).code).toBe(0);
  expect(git(w.clone, "show", "--name-only", "--format=", "HEAD")).toBe("bad.txt");
  expect(buildLeftover("dir/.0123abcd-00000000.bun-build")).toBe(true);
  expect(buildLeftover("src/build.ts")).toBe(false);
});

test("continue after an interrupted harness conflict call commits leftovers that pass the checks as the agent's", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  interruptHarness(w, { kind: "conflict", patch: "right", files: ["base.txt"] });
  git(w.clone, "checkout", "-q", "--theirs", "--", "base.txt");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(git(w.clone, "log", "-1", "--format=%B", "HEAD^{/Merge right}")).toBe("Merge right: about right\n\nResolved-By: harness");
  expect(resumed.out).toContain("agent resolved the conflict in right");
  expect(read(join(latest(w), "report.md"))).toContain("## Agent-resolved merges\n\n- right: base.txt\n");
  expect(state(w)).toBeNull();
});

test("continue after an interrupted harness conflict call rejects leftovers that fail the checks", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  const before = head(w);
  interruptHarness(w, { kind: "conflict", patch: "right", files: ["base.txt"] });
  git(w.clone, "checkout", "-q", "--theirs", "--", "base.txt");
  write(w.clone, { "package.json": "changed\n" });
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(2);
  expect(resumed.out).toContain("the interrupted harness resolution of right was rejected");
  expect(resumed.out).toContain("outside the conflict: package.json");
  expect(head(w)).toBe(before);
  expect(git(w.clone, "rev-parse", "-q", "--verify", "MERGE_HEAD")).toMatch(/^[0-9a-f]{40}$/);
  expect(read(join(latest(w), "report.md"))).toContain("Result: stopped (exit 2)");
  expect(state(w)?.harnessCall ?? null).toBeNull();
});

test("continue after an interrupted harness build call commits an accepted fix as the agent's and hands it off", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["bad"]);
  expect((await run(w, "build")).code).toBe(3);
  const log = join(state(w)!.reportDir, "steps", "typecheck.log");
  interruptHarness(w, { kind: "check", step: "typecheck", log });
  write(w.clone, { "bad.txt": "fixed\n" });
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(git(w.clone, "log", "-1", "--format=%B")).toBe("debaser: fix typecheck (agent)\n\nFixed-By: harness");
  expect(resumed.out).toMatch(/agent fix [0-9a-f]{7} for typecheck/);
  expect(read(join(latest(w), "report.md"))).toMatch(/## Fix commits\n\n- [0-9a-f]{7} typecheck \(agent\): bad\.txt\n/);
  expect(handoffs(w)).toEqual(["bad.md"]);
  expect(read(join(latest(w), "handoffs", "bad.md"))).toContain("- Kind: build-drift\n");
});

test("continue after an interrupted harness build call that changed nothing stops without committing", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["bad"]);
  expect((await run(w, "build")).code).toBe(3);
  const before = head(w);
  interruptHarness(w, { kind: "check", step: "typecheck", log: join(state(w)!.reportDir, "steps", "typecheck.log") });
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(3);
  expect(resumed.out).toContain("the interrupted harness fix for typecheck was rejected: it changed nothing");
  expect(head(w)).toBe(before);
  expect(state(w)?.phase).toBe("verify");
  expect(state(w)?.harnessCall ?? null).toBeNull();
});
void stubSteps;

test("continue after a conflict harness that failed to run asks it again", async () => {
  const w = world();
  conflicting(w);
  const flag = join(fresh("auth"), "expired");
  writeFileSync(flag, "");
  const h = stubHarness(`if [ -f "${flag}" ]; then echo "session expired" >&2; exit 1; fi\n${takeTheirs}`);
  configure(w, ["left", "right"], { harness: { command: h.command, attempts: 3 } });
  const stopped = await run(w, "build");
  expect(stopped.code).toBe(5);
  expect(stopped.out).toContain("the harness failed to run on the conflict in right: it exited 1: session expired");
  expect(h.calls()).toBe(1);
  rmSync(flag);
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(git(w.clone, "log", "-1", "--format=%B", "HEAD^{/Merge right}")).toBe("Merge right: about right\n\nResolved-By: harness");
});

test("a recipe's leftovers are never committed with a fix", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const h = stubHarness(`${fixBroken}\nmkdir -p cache && echo junk > cache/tmp.o`);
  configure(w, ["bad"], { harness: { command: h.command }, raw: 'leftovers = ["cache/**"]\n' });
  expect((await run(w, "build")).code).toBe(0);
  expect(git(w.clone, "show", "--name-only", "--format=", "HEAD")).toBe("bad.txt");
});
