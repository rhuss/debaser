import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "../../src/cli/main";
import type { LiveEvent } from "../../src/live/events";
import * as term from "../../src/live/term";
import * as timings from "../../src/timings/timings";
import {
  advanceClock,
  branch,
  configure,
  configureOwn,
  conflicting,
  conflictingLine,
  dirOf,
  eventWords,
  fresh,
  git,
  head,
  inOrder,
  interruptHarness,
  noGh,
  read,
  run,
  runWith,
  state,
  stubHarness,
  takeTheirs,
  tip,
  upstreamMoves,
  withStep,
  world,
  write,
} from "../support/world";

setDefaultTimeout(180_000);
const scratch = tmpdir();
/** Terminal output as text: colors and links gone, a frame redrawn in place kept as written. */
const shown = (text: string) =>
  text
    .replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const unpainted = (text: string) => Bun.stripANSI(text);

test("a build records its timings and the next one has history", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  const first = timings.loadHistory(dirOf(w)).runs;
  expect(first.length).toBe(1);
  expect(first[0]).toMatchObject({ command: "build", partial: false });
  expect(Object.keys(first[0].items)).toEqual(
    expect.arrayContaining(["fetch", "merge:mine", "step:typecheck", "step:test", "step:build"]),
  );
  expect(first[0].activeMs).toBeGreaterThan(0);
  expect((await run(w, "build")).code).toBe(0);
  const h = timings.loadHistory(dirOf(w));
  expect(h.runs.length).toBe(2);
  expect(timings.estimate(h, "build", ["fetch", "merge:mine"], {}, 0).last).toEqual(h.runs[1]);
});

test("a run state without timing loads", async () => {
  const w = world();
  branch(w, "left", { "base.txt": "one\nLEFT\nthree\n" });
  branch(w, "right", { "base.txt": "one\nRIGHT\nthree\n" });
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  // A run state an older tool wrote: no timings, no harness usage.
  const old = JSON.parse(read(join(dirOf(w), "run.json")));
  expect(old.timing).toBeDefined();
  delete old.timing;
  delete old.harnessUsage;
  writeFileSync(join(dirOf(w), "run.json"), JSON.stringify(old, null, 2));
  write(w.clone, { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(w.clone, "add", "base.txt");
  expect((await run(w, "continue")).code).toBe(0);
  const runs = timings.loadHistory(dirOf(w)).runs;
  expect(runs.length).toBe(1);
  // The merge it stopped in started before the run state kept timings, so it has none.
  expect(Object.keys(runs[0].items)).toEqual(["step:install", "step:typecheck", "step:test", "step:build"]);
});

test("rollback on a terminal shows its steps and ends in a card", async () => {
  const w = world();
  branch(w, "left", { "base.txt": "one\nLEFT\nthree\n" });
  branch(w, "right", { "base.txt": "one\nRIGHT\nthree\n" });
  configure(w, ["left"]);
  expect((await run(w, "build")).code).toBe(0);
  const built = head(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  const result = await runWith(w, { live: "inline", color: true, columns: 100, rows: 40 }, "rollback");
  expect(result.code).toBe(0);
  expect(head(w)).toBe(built);
  const text = shown(result.out);
  expect(text).toContain("debaser rollback · debaser\n");
  expect(text).toMatch(new RegExp(`✓ undo +debaser back at ${built.slice(0, 7)}`));
  expect(text).toMatch(/✓ artifact +dist\/widget-custom restored/);
  expect(text).toMatch(/✓ install +dependencies restored/);
  expect(text).toMatch(
    new RegExp(`✓ rolled back to debaser at ${built.slice(0, 7)}, as before the run in \\d+:\\d\\d\\n`),
  );
  // The install's output stays in its log, out of the view.
  expect(result.err).toBe("");
  expect(text).not.toContain("debaser: restoring dependencies");
});

test("an error before the run began ends the live view in a card", async () => {
  const w = world();
  configure(w, []);
  const result = await runWith(w, { live: "inline", color: true, columns: 100, rows: 40 }, "continue");
  expect(result.code).toBe(1);
  expect(shown(result.out)).toContain("✗ debaser continue: there is no stopped run to continue\n");
});

test("a build signals stages, items and the end", async () => {
  const w = world();
  conflicting(w);
  const tried = join(fresh("flaky"), "tried");
  const steps = withStep("typecheck", { run: ["sh", "-c", `test -f "${tried}" || { touch "${tried}"; false; }`] });
  configure(w, ["left", "right"], { steps, harness: { command: stubHarness(takeTheirs).command } });
  const events: LiveEvent[] = [];
  const result = await runWith(w, { sink: e => void events.push(e) }, "build");
  expect(result.code).toBe(0);
  const words = eventWords(events);
  expect(
    inOrder(words, [
      "begin",
      "stage fetch start",
      "stage fetch done",
      "stage merge start",
      "item merge left done merged",
      "item merge right start",
      "harness start",
      "harness end ok:true",
      "item merge right done agent-resolved",
      "stage merge done",
      "stage verify start",
      "retry flaky",
      "item verify typecheck done flaky",
      "stage verify done",
      "end ok:true",
    ]),
  ).toBeNull();
  expect(words.filter(word => word === "begin").length).toBe(1);
  expect(words.at(-1)).toBe("end ok:true");
  const begin = events[0] as Extract<LiveEvent, { t: "begin" }>;
  expect(begin).toMatchObject({
    command: "build",
    branch: "debaser",
    stages: ["fetch", "merge", "verify", "accept"],
    items: { merge: ["left", "right"], verify: ["install", "typecheck", "test", "build"] },
    harness: null,
  });
  const fetched = events.find(e => e.t === "stage" && e.stage === "fetch" && e.state === "done");
  expect(fetched).toMatchObject({
    upstream: { name: "upstream/main", tip: git(w.clone, "rev-parse", "upstream/main") },
  });
  const end = events.at(-1) as Extract<LiveEvent, { t: "end" }>;
  const outcome = result.out.trimEnd().split("\n");
  expect(end.headline).toBe(outcome[0].replace(/^debaser: /, ""));
  expect(end.lines).toEqual(outcome.slice(1));
  expect(end.report).toEndWith("/report.md");
  expect(end.activeMs).toBeGreaterThanOrEqual(0);
  expect(result.out).toContain(`  report: ${end.report}\n`);
});

test("a build prints the same with and without a sink", async () => {
  const outputs = [];
  for (const sink of [undefined, () => {}]) {
    const w = world();
    conflicting(w);
    configure(w, ["left", "right"], { harness: { command: stubHarness(takeTheirs).command } });
    const result = await runWith(w, { sink }, "build");
    expect(result.code).toBe(0);
    outputs.push(
      [result.out, result.err].map(text =>
        text
          .replaceAll(w.clone, "<clone>")
          .replace(/\d{8}-\d{6}(-\d+)?/g, "<stamp>")
          .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>"),
      ),
    );
  }
  expect(outputs[1]).toEqual(outputs[0]);
});

test("a stopped run signals the stop, and continue replays it first", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  const events: LiveEvent[] = [];
  const stopped = await runWith(w, { sink: e => void events.push(e) }, "build");
  expect(stopped.code).toBe(2);
  const words = eventWords(events);
  expect(inOrder(words, ["item merge left done merged", "item merge right failed stopped", "end ok:false"])).toBeNull();
  expect(events.at(-1)).toMatchObject({ t: "end", ok: false, code: 2, headline: "stopped: merge conflict in right" });
  git(w.clone, "checkout", "-q", "--theirs", "base.txt");
  git(w.clone, "add", "base.txt");
  const again: LiveEvent[] = [];
  expect((await runWith(w, { sink: e => void again.push(e) }, "continue")).code).toBe(0);
  const next = eventWords(again);
  expect(next[0]).toBe("begin");
  expect(again[0]).toMatchObject({ command: "continue" });
  expect(
    inOrder(next, [
      "begin",
      "stage fetch done",
      "item merge left done merged",
      "item merge right start",
      "item merge right done user-resolved",
      "stage merge done",
      "stage verify done",
      "end ok:true",
    ]),
  ).toBeNull();
});

test("a rebase run signals its branches", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  const events: LiveEvent[] = [];
  const result = await runWith(w, { sink: e => void events.push(e) }, "rebase");
  expect(result.code).toBe(0);
  const words = eventWords(events);
  expect(
    inOrder(words, [
      "begin",
      "stage fetch start",
      "stage fetch done",
      "stage rebase start",
      "item rebase mine start",
      "item rebase mine done rebased",
      "stage rebase done",
      "end ok:true",
    ]),
  ).toBeNull();
  expect(events[0]).toMatchObject({ command: "rebase", stages: ["fetch", "rebase"] });
});

test("a build's rebase phase signals its branches and harness calls", async () => {
  const w = world();
  branch(w, "clean", { "clean.txt": "clean\n" });
  branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["clean", "stale"], { harness: { command: stubHarness(takeTheirs).command } });
  const events: LiveEvent[] = [];
  expect((await runWith(w, { sink: e => void events.push(e) }, "build")).code).toBe(0);
  expect(events[0]).toMatchObject({ stages: ["fetch", "rebase", "merge", "verify", "accept"] });
  expect(
    inOrder(eventWords(events), [
      "stage fetch done",
      "stage rebase start",
      "item rebase stale start",
      "harness start",
      "harness end ok:true",
      "item rebase stale done rebased",
      "stage rebase done",
      "stage merge start",
    ]),
  ).toBeNull();
  expect(events.find(e => e.t === "harness" && e.state === "start")).toMatchObject({
    stage: "rebase",
    id: "stale",
    files: ["base.txt"],
  });
  expect(events.find(e => e.t === "stage" && e.stage === "rebase" && e.state === "done")).toMatchObject({
    summary: "2 rebased",
  });
});

test("build --verbose is accepted and plain output is unchanged", async () => {
  const outputs = [];
  for (const args of [["build"], ["build", "--verbose"]]) {
    const w = world();
    branch(w, "mine", { "mine.txt": "mine\n" });
    configure(w, ["mine"]);
    const result = await run(w, ...args);
    expect(result.code).toBe(0);
    outputs.push(
      [result.out, result.err].map(text =>
        text
          .replaceAll(w.clone, "<clone>")
          .replace(/\d{8}-\d{6}(-\d+)?/g, "<stamp>")
          .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>"),
      ),
    );
  }
  expect(outputs[1]).toEqual(outputs[0]);
  expect(outputs[0][1]).toContain("debaser: merging mine\n");
});

test("a live build prints a summary card that points at the report", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  const result = await runWith(w, { live: "inline", color: true, columns: 100, rows: 40 }, "build");
  expect(result.code).toBe(0);
  expect(result.err).toBe("");
  const out = unpainted(result.out);
  expect(result.out).toContain("\x1b[?25l");
  expect(out).toContain("debaser build");
  expect(out).toContain("✓ built dist/widget-custom");
  // The card wraps the long report path; without the spaces it reads as one.
  expect(out.replace(/\s+/g, "")).toMatch(/report\/\S+\/\.git\/debaser\/reports\/\d{8}-\d{6}\/report\.md/);
  expect(out).toContain(" patches   ■ 1 merged");
  // Each merge is in the report and the plain output, not on the card.
  expect(out).not.toContain("  merged mine ");
  expect(result.out).toEndWith(term.restore());
});

test("a live command that throws ends its view with the error", async () => {
  const w = world();
  noGh(w);
  configure(w, ["#99"]);
  const result = await runWith(w, { live: "inline", color: true, columns: 100, rows: 40 }, "build");
  expect(result.code).toBe(1);
  expect(result.err).toBe("");
  const out = unpainted(result.out);
  // The run had begun: its frame came first, the card with the error last.
  expect(out).toContain("debaser build");
  expect(out).toMatch(/✗ cannot fetch acme\/widget#99: .* in \d+:\d\d\n/);
  expect(result.out).toEndWith(term.restore());
});

test("a timings history that can't be written is a warning, and the run keeps its outcome", async () => {
  for (const live of [false, true]) {
    const w = world();
    branch(w, "mine", { "mine.txt": "mine\n" });
    configure(w, ["mine"]);
    // The history is written through a temporary file, which a directory blocks.
    mkdirSync(join(dirOf(w), "timings.json.tmp"), { recursive: true });
    const result = await runWith(w, live ? { live: "inline", color: true, columns: 100, rows: 40 } : {}, "build");
    expect(result.code).toBe(0);
    const out = unpainted(result.out);
    if (live) {
      expect(result.err).toBe("");
      expect(out).toContain("✓ built dist/widget-custom");
      expect(out.slice(out.lastIndexOf("✓ built"))).toContain("  warning: could not record timings: ");
    } else {
      expect(out).toStartWith("debaser: built dist/widget-custom");
      expect(out).toContain(`  merged mine ${tip(w, "mine")!.slice(0, 7)} about mine\n`);
      expect(result.err).toContain("debaser: warning: could not record timings: ");
    }
    expect(state(w)).toBeNull();
  }
});

test("the usage names --verbose for every command with a live view", async () => {
  let out = "";
  expect(await main(["--help"], { cwd: scratch, env: {}, out: text => void (out += text), err: () => {} })).toBe(0);
  for (const command of ["build [", "rebase [", "rebase --skip-branch", "continue"])
    expect(out.split("\n").find(line => line.startsWith(`  ${command}`))).toContain("[--verbose]");
});

test("a live run shows its warnings on the card", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"], { harness: { command: ["/nonexistent/harness", "{prompt_file}"] } });
  const result = await runWith(w, { live: "inline", color: true, columns: 100, rows: 40 }, "build");
  expect(result.code).toBe(2);
  expect(result.err).toBe("");
  const out = unpainted(result.out),
    card = out.slice(out.lastIndexOf("✗ stopped after"));
  expect(card).toContain("  warning: harness /nonexistent/harness is not executable; continuing without it\n");
  expect(card).toContain("  files: base.txt");
});

test("a live run pauses for the push question", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  const asked: string[] = [];
  const result = await runWith(
    w,
    { live: "inline", color: true, columns: 100, rows: 40, ask: q => (asked.push(q), "n") },
    "rebase",
  );
  expect(result.code).toBe(0);
  expect(asked).toEqual(["Force-push 1 rebased branch to origin (mine)? [y/N] "]);
  const at = result.out.indexOf(asked[0]);
  expect(at).toBeGreaterThan(0);
  expect(result.out.lastIndexOf("\x1b[?25h", at)).toBeGreaterThanOrEqual(0);
  expect(result.out.lastIndexOf("\x1b[?25h", at)).toBeGreaterThan(result.out.lastIndexOf("\x1b[?25l", at));
  expect(unpainted(result.out.slice(at))).toContain("git push --force-with-lease=refs/heads/mine:");
  expect(result.out).toEndWith(term.restore());
});

test("step names link to their logs, in a run and in its continue", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  const events: LiveEvent[] = [];
  expect((await runWith(w, { sink: e => void events.push(e) }, "build")).code).toBe(2);
  const steps = state(w)!.reportDir + "/steps";
  git(w.clone, "checkout", "-q", "--theirs", "base.txt");
  git(w.clone, "add", "base.txt");
  expect((await runWith(w, { sink: e => void events.push(e) }, "continue")).code).toBe(0);
  const logs = Object.fromEntries(
    ["install", "typecheck", "test", "build"].map(step => [step, pathToFileURL(`${steps}/${step}.log`).href]),
  );
  expect(events.find(e => e.t === "begin" && e.command === "continue")).toMatchObject({ links: logs });
  expect(events.find(e => e.t === "stage" && e.stage === "verify" && e.state === "start" && e.links)).toMatchObject({
    links: logs,
  });
});

test("continue shows the earlier progress", async () => {
  const w = world();
  conflicting(w);
  branch(w, "first", { "first.txt": "first\n" });
  configure(w, ["first", "left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  git(w.clone, "checkout", "-q", "--theirs", "base.txt");
  git(w.clone, "add", "base.txt");
  const events: LiveEvent[] = [];
  expect((await runWith(w, { sink: e => void events.push(e) }, "continue")).code).toBe(0);
  const words = eventWords(events);
  expect(words.slice(0, 6)).toEqual([
    "begin",
    "stage fetch start",
    "stage fetch done",
    "stage merge start",
    "item merge first done merged",
    "item merge left done merged",
  ]);
});

test("a continue that stops again before going on ends its item as stopped", async () => {
  const stopsOf = (events: LiveEvent[]) =>
    eventWords(events).filter(word => /^item .* (start|failed)/.test(word) || word.startsWith("end"));
  // Merge conflicts still unresolved.
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  const unmerged: LiveEvent[] = [];
  expect((await runWith(w, { sink: e => void unmerged.push(e) }, "continue")).code).toBe(2);
  expect(stopsOf(unmerged).slice(-3)).toEqual([
    "item merge right start",
    "item merge right failed stopped",
    "end ok:false",
  ]);

  // An interrupted harness fix that changed nothing.
  const fix = world();
  branch(fix, "bad", { "bad.txt": "BROKEN\n" });
  configure(fix, ["bad"]);
  expect((await run(fix, "build")).code).toBe(3);
  interruptHarness(fix, { kind: "check", step: "typecheck", log: join(state(fix)!.reportDir, "steps", "typecheck.log") });
  const rejected: LiveEvent[] = [];
  expect((await runWith(fix, { sink: e => void rejected.push(e) }, "continue")).code).toBe(3);
  expect(stopsOf(rejected).slice(-3)).toEqual([
    "item verify typecheck start",
    "item verify typecheck failed failed",
    "end ok:false",
  ]);

  // An interrupted harness resolution that fails the checks.
  const conflict = world();
  conflicting(conflict);
  configure(conflict, ["left", "right"]);
  expect((await run(conflict, "build")).code).toBe(2);
  interruptHarness(conflict, { kind: "conflict", patch: "right", files: ["base.txt"] });
  const resolution: LiveEvent[] = [];
  expect((await runWith(conflict, { sink: e => void resolution.push(e) }, "continue")).code).toBe(2);
  expect(stopsOf(resolution).slice(-2)).toEqual(["item merge right failed stopped", "end ok:false"]);
});

test("a rebase run records its timings, without the wait for the push answer", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  const hour = 3_600_000,
    result = await runWith(w, { ask: () => (advanceClock(hour), "y") }, "rebase");
  expect(result.code).toBe(0);
  const runs = timings.loadHistory(dirOf(w)).runs;
  expect(runs.length).toBe(1);
  expect(runs[0]).toMatchObject({ command: "rebase", partial: false });
  expect(Object.keys(runs[0].items)).toEqual(["fetch", "rebase:mine", "push"]);
  expect(runs[0].activeMs).toBeLessThan(hour);
});

test("an after-build stage is planned only for a non-empty after_build, in a build and its replay", async () => {
  const stagesOf = (events: LiveEvent[]) => events.flatMap(e => (e.t === "begin" ? e.stages : []));
  for (const [afterBuild, planned] of [
    [["true"], true],
    [[], false],
  ] as const) {
    const w = world();
    conflicting(w);
    configure(w, ["left", "right"], { afterBuild: [...afterBuild] });
    const stopped: LiveEvent[] = [];
    expect((await runWith(w, { sink: e => void stopped.push(e) }, "build")).code).toBe(2);
    expect(stagesOf(stopped).includes("after-build")).toBe(planned);
    git(w.clone, "checkout", "-q", "--theirs", "base.txt");
    git(w.clone, "add", "base.txt");
    const resumed: LiveEvent[] = [];
    expect((await runWith(w, { sink: e => void resumed.push(e) }, "continue")).code).toBe(0);
    expect(resumed[0]?.t).toBe("begin");
    expect(stagesOf(resumed).includes("after-build")).toBe(planned);
  }
});
