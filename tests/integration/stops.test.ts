import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as runstate from "../../src/core/runstate";
import * as timings from "../../src/timings/timings";
import {
  branch,
  commit,
  configure,
  conflicting,
  dirOf,
  fresh,
  git,
  handoffs,
  head,
  installPath,
  latest,
  read,
  run,
  state,
  subjects,
  upstreamMoves,
  write,
  world,
  withStep,
  type World,
} from "../support/world";

setDefaultTimeout(120_000);


test("a conflict without a harness stops with the files, then continue finishes and rerere replays it", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  const stopped = await run(w, "build");
  expect(stopped.code).toBe(2);
  expect(stopped.out).toContain("merge conflict in right");
  expect(stopped.out).toContain("files: base.txt");
  expect(stopped.out).toContain("debaser continue");
  // A ready-to-run agent prompt for the conflict (FR-014).
  const prompt = join(latest(w), "fix-conflict.md");
  expect(stopped.out).toMatch(/prompt for an agent: \S+\/fix-conflict\.md\n  run it: cd /);
  expect(read(prompt)).toContain("- Patch: right");
  expect(read(prompt)).toContain("base.txt");
  expect(git(w.clone, "rev-parse", "-q", "--verify", "MERGE_HEAD")).toMatch(/^[0-9a-f]{40}$/);
  expect(state(w)?.phase).toBe("merge");
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
  // Still conflicted: continue refuses.
  expect((await run(w, "continue")).code).toBe(2);
  write(w.clone, { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(w.clone, "add", "base.txt");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(state(w)).toBeNull();
  expect(read(join(w.clone, "base.txt"))).toBe("one\nLEFT and RIGHT\nthree\n");
  const again = await run(w, "build");
  expect(again.code).toBe(0);
  expect(read(join(w.clone, "base.txt"))).toBe("one\nLEFT and RIGHT\nthree\n");
  expect(subjects(w, "upstream/main..HEAD")).toEqual(["Merge right: about right", "Merge left: about left"]);
});

test("a step failing only on the custom branch stops with 3; failing on upstream too stops with 4", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["bad"]);
  const failed = await run(w, "build");
  expect(failed.code).toBe(3);
  expect(failed.out).toContain("typecheck failed");
  expect(state(w)?.step).toBe("typecheck");
  expect(existsSync(join(dirOf(w), "work", "isolated-upstream"))).toBe(false);
  // The user fixes it in the tree; continue commits the fix and finishes.
  rmSync(join(w.clone, "bad.txt"));
  const fixed = await run(w, "continue");
  expect(fixed.code).toBe(0);
  expect(git(w.clone, "log", "-1", "--format=%s")).toBe("debaser: fix typecheck (user)");

  const u = world();
  commit(u.seed, { "upstream.txt": "BROKEN\n" }, "upstream breaks");
  git(u.seed, "push", "-q", "origin", "main");
  branch(u, "fine", { "fine.txt": "fine\n" }, "main");
  configure(u, ["fine"]);
  const broken = await run(u, "build");
  expect(broken.code).toBe(4);
  expect(broken.out).toContain("upstream is broken");
  expect(broken.out).toContain("roll back, then build once upstream is fixed");
  expect(broken.out).not.toContain("continue: ");
});

test("the plain-upstream rerun runs the earlier steps first, so a step needing their output isn't blamed on upstream", async () => {
  const w = world();
  branch(w, "bad", { "bad.flag": "x\n" });
  const steps = [
    { name: "install", run: ["true"] },
    { name: "native", run: ["sh", "-c", "touch native.out"] },
    { name: "test", run: ["sh", "-c", "test -f native.out && test ! -f bad.flag"] },
  ];
  configure(w, ["bad"], { steps, artifact: null });
  const failed = await run(w, "build");
  expect(failed.code).toBe(3);
  expect(failed.out).not.toContain("upstream is broken");
  expect(existsSync(join(latest(w), "isolated", "upstream-native.log"))).toBe(true);
});

test("a step that fails once and passes when run again is reported as flaky, never fixed or blamed", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  const tried = join(fresh("flaky"), "tried");
  configure(w, ["a"], { steps: withStep("typecheck", { run: ["sh", "-c", `test -f "${tried}" || { touch "${tried}"; false; }`] }) });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(git(w.clone, "log", "--first-parent", "--format=%s", "upstream/main..HEAD")).toBe("Merge a: about a");
  expect(existsSync(join(latest(w), "isolated", "upstream-typecheck.log"))).toBe(false);
  expect(result.out).toContain("warning: typecheck failed once and passed when run again; it may be flaky");
  const text = read(join(latest(w), "report.md"));
  expect(text).toContain("- typecheck failed once and passed when run again; it may be flaky (log: typecheck-flaky-1.log)");
  expect(text).toContain("- typecheck: passed");
  expect(existsSync(join(latest(w), "steps", "typecheck-flaky-1.log"))).toBe(true);
  const steps = JSON.parse(read(join(latest(w), "result.json"))).steps;
  expect(steps.find((s: { name: string }) => s.name === "typecheck").result).toBe("flaky");
});

const conflicted = () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  return w;
};
test("a stopped run is recorded once, when it finishes", async () => {
  const w = conflicted();
  expect((await run(w, "build")).code).toBe(2);
  expect(existsSync(timings.historyPath(dirOf(w)))).toBe(false);
  expect(Object.keys(state(w)?.timing?.items ?? {})).toEqual(["fetch", "merge:left"]);
  write(w.clone, { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(w.clone, "add", "base.txt");
  expect((await run(w, "continue")).code).toBe(0);
  const runs = timings.loadHistory(dirOf(w)).runs;
  expect(runs.length).toBe(1);
  expect(runs[0]).toMatchObject({ command: "build", partial: false });
  expect(Object.keys(runs[0].items)).toEqual(expect.arrayContaining(["fetch", "merge:left", "merge:right", "step:build"]));
  // Rolled back instead, the run is no history: only finished runs count.
  const v = conflicted();
  expect((await run(v, "build")).code).toBe(2);
  expect((await run(v, "rollback")).code).toBe(0);
  expect(existsSync(timings.historyPath(dirOf(v)))).toBe(false);
});

test("a successful run keeps the previous build as -prev; a stopped run leaves the backups alone", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  const first = head(w),
    firstArtifact = read(installPath(w));
  git(w.clone, "checkout", "-q", "mine");
  commit(w.clone, { "mine.txt": "mine 2\n" });
  git(w.clone, "checkout", "-q", "debaser");
  expect((await run(w, "build")).code).toBe(0);
  const second = head(w),
    secondArtifact = read(installPath(w));
  expect(git(w.clone, "rev-parse", "debaser-prev")).toBe(first);
  expect(read(`${installPath(w)}.prev`)).toBe(firstArtifact);
  // A stopped run: the backups still name the first build.
  branch(w, "clash", { "mine.txt": "clash\n" });
  configure(w, ["mine", "clash"]);
  expect((await run(w, "build")).code).toBe(2);
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
  expect(git(w.clone, "rev-parse", "debaser-prev")).toBe(first);
  expect(read(`${installPath(w)}.prev`)).toBe(firstArtifact);
  // Rolling back the stopped run returns to where it started.
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(head(w)).toBe(second);
  expect(read(installPath(w))).toBe(secondArtifact);
  expect(state(w)).toBeNull();
  expect(git(w.clone, "status", "--porcelain")).toBe("");
  // With no run, rollback restores the backups.
  expect((await run(w, "rollback")).code).toBe(0);
  expect(head(w)).toBe(first);
  expect(read(installPath(w))).toBe(firstArtifact);
});

test("rolling back a stopped first run returns to the branch it started on", async () => {
  const w = conflicted();
  expect((await run(w, "build")).code).toBe(2);
  expect((await run(w, "rollback")).code).toBe(0);
  expect(git(w.clone, "branch", "--show-current")).toBe("main");
  expect(git(w.clone, "branch", "--list", "debaser")).toBe("");
  expect(existsSync(installPath(w))).toBe(false);
});

test("a run that is stopped refuses another with where it stopped and what to run", async () => {
  const w = conflicted();
  expect((await run(w, "build")).code).toBe(2);
  const plain = await run(w, "build");
  expect(plain.code).toBe(1);
  expect(plain.err).toContain("debaser: a run is stopped or in progress; resume it with `continue` or undo it with `rollback`\n");
  expect(plain.err).toMatch(/\n {2}stopped: while merging right \(2 of 2\), started \d+s ago\n/);
  expect(plain.err).toContain("  next: debaser continue, or debaser rollback\n");
});

test("continue after an interrupted step commits only tracked changes", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  configure(w, ["bad"]);
  expect((await run(w, "build")).code).toBe(3);
  runstate.saveRun(dirOf(w), { ...state(w)!, stopped: null });
  write(w.clone, { "scratch-notes.md": "mine\n", "bad.txt": "fixed\n" });
  expect((await run(w, "continue")).code).toBe(0);
  expect(git(w.clone, "show", "--name-only", "--format=", "HEAD")).toBe("bad.txt");
  expect(git(w.clone, "status", "--porcelain")).toBe("?? scratch-notes.md");
});

test("continue refuses when the custom branch is no longer checked out", async () => {
  const w = conflicted();
  expect((await run(w, "build")).code).toBe(2);
  git(w.clone, "merge", "--abort");
  git(w.clone, "checkout", "-q", "left");
  const left = head(w),
    result = await run(w, "continue");
  expect(result.code).toBe(1);
  expect(result.err).toContain("debaser is not checked out");
  expect(result.err).toContain("rollback");
  expect(head(w)).toBe(left);
  expect(git(w.clone, "branch", "--show-current")).toBe("left");
});

test("a reset that fails forgets the run and changes nothing", async () => {
  const w = world();
  upstreamMoves(w, { "new.txt": "upstream\n" });
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  write(w.clone, { "new.txt": "untracked and in the way\n" });
  const start = head(w),
    result = await run(w, "build");
  expect(result.code).toBe(1);
  expect(state(w)).toBeNull();
  expect(head(w)).toBe(start);
  expect(git(w.clone, "branch", "--show-current")).toBe("main");
  expect(read(join(w.clone, "new.txt"))).toBe("untracked and in the way\n");
});

test("rollback of a stopped run keeps uncommitted edits on another branch", async () => {
  const w = conflicted();
  expect((await run(w, "build")).code).toBe(2);
  git(w.clone, "merge", "--abort");
  git(w.clone, "checkout", "-q", "left");
  write(w.clone, { "base.txt": "my edit\n" });
  const refused = await run(w, "rollback");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("left has uncommitted changes");
  expect(read(join(w.clone, "base.txt"))).toBe("my edit\n");
  expect(state(w)).not.toBeNull();
});

function countedInstall(w: World) {
  const dir = fresh("install"),
    count = join(dir, "count"),
    broken = join(dir, "broken");
  configure(w, ["bad"], { steps: withStep("install", { run: ["sh", "-c", `test ! -f "${broken}" && echo x >> "${count}"`] }) });
  return { runs: () => (existsSync(count) ? read(count).split("\n").filter(Boolean).length : 0), broken };
}

test("rollback reinstalls dependencies, and continue finishes a rollback whose install failed", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const start = head(w),
    install = countedInstall(w);
  expect((await run(w, "build")).code).toBe(3);
  const before = install.runs();
  writeFileSync(install.broken, "");
  const failed = await run(w, "rollback");
  expect(failed.code).toBe(1);
  expect(failed.err).toContain("dependency restore failed after rollback");
  expect(state(w)?.phase).toBe("rollback");
  rmSync(install.broken);
  expect((await run(w, "continue")).code).toBe(0);
  expect(state(w)).toBeNull();
  expect(head(w)).toBe(start);
  expect(install.runs()).toBe(before + 1);
});

test("a rollback refused for uncommitted changes leaves the stopped run to continue", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  countedInstall(w);
  expect((await run(w, "build")).code).toBe(3);
  git(w.clone, "checkout", "-q", "main");
  write(w.clone, { "base.txt": "edited\n" });
  const refused = await run(w, "rollback");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("has uncommitted changes, and rollback would discard them");
  expect(state(w)?.phase).toBe("verify");
  expect(state(w)?.stopped?.code).toBe(3);
  git(w.clone, "checkout", "-q", "--", "base.txt");
  git(w.clone, "checkout", "-q", "debaser");
  expect((await run(w, "continue")).code).toBe(3);
});

test("rollback to the previous build reinstalls dependencies", async () => {
  const w = world();
  branch(w, "bad", { "good.txt": "fine\n" });
  const install = countedInstall(w);
  expect((await run(w, "build")).code).toBe(0);
  const first = head(w);
  upstreamMoves(w, { "up.txt": "up\n" });
  expect((await run(w, "build")).code).toBe(0);
  const before = install.runs();
  expect((await run(w, "rollback")).code).toBe(0);
  expect(head(w)).toBe(first);
  expect(install.runs()).toBe(before + 1);
});

test("a step stop names the patches behind it and writes a prompt for fixing it with an agent", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  configure(w, ["a", "b"], {
    steps: withStep("typecheck", {
      run: ["sh", "-c", 'test -f ok.txt || ! { test -f a.txt && test -f b.txt; } || { echo "a.txt clashes with b.txt"; false; }'],
    }),
  });
  const stopped = await run(w, "build");
  expect(stopped.code).toBe(3);
  expect(stopped.out).toContain("caused by: a and b only together");
  expect(stopped.out).toMatch(/stopped: typecheck failed\n {2}caused by: /);
  const prompt = stopped.out.match(/prompt for an agent: (\S+\/fix-typecheck\.md)\n/)![1];
  expect(stopped.out).toContain(`run it: cd ${realpathSync(w.clone)} && claude "$(cat ${prompt})"`);
  const text = read(prompt);
  expect(text).toContain("- Cause: a and b only together");
  expect(text).toContain("- a: about a");
  expect(text).toContain("a.txt clashes with b.txt");
  expect(text).toContain("`debaser continue`");
  expect(handoffs(w)).toEqual(["a.md", "b.md"]);
  expect(read(join(latest(w), "handoffs", "a.md"))).toContain("none; the patched build stopped on it");
  // The user's fix answers the same patches: its handoffs show it.
  write(w.clone, { "ok.txt": "ok\n" });
  expect((await run(w, "continue")).code).toBe(0);
  expect(handoffs(w)).toEqual(["a.md", "b.md"]);
  const a = read(join(latest(w), "handoffs", "a.md"));
  expect(a).toContain("debaser: fix typecheck (user)");
  expect(a).toContain("clashes with: b");
});

test("a step that runs past its timeout counts as failing: rerun, then on plain upstream", async () => {
  const w = world();
  branch(w, "slow", { "slow.txt": "slow\n" });
  configure(w, ["slow"], { steps: withStep("typecheck", { run: ["sh", "-c", "test -f slow.txt && sleep 30 || true"], timeout: 1 }) });
  const started = Date.now(),
    result = await run(w, "build");
  expect(result.code).toBe(3);
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(readFileSync(join(latest(w), "steps", "typecheck.log"), "utf8")).toContain("timed out");
  // It passed on plain upstream (no slow.txt there), so a patch is blamed.
  expect(existsSync(join(latest(w), "isolated", "upstream-typecheck.log"))).toBe(true);
});

test("Ctrl-C, SIGTERM or SIGHUP in a step ends the run with 130, 143 or 129, keeps its state and releases the lock", async () => {
  for (const [signal, code] of [["INT", 130], ["TERM", 143], ["HUP", 129]] as const) {
    const w = world();
    branch(w, "mine", { "mine.txt": "mine\n" });
    // The step signals its parent, debaser, as a Ctrl-C, a kill or a hangup would.
    configure(w, ["mine"], { steps: withStep("test", { run: ["sh", "-c", `kill -${signal} $(ps -o ppid= -p $$); sleep 5`] }) });
    // Through the real command line, so the signal reaches debaser's own process.
    const main = join(import.meta.dir, "..", "..", "src", "cli", "main.ts"),
      child = Bun.spawn(["bun", main, "build"], { cwd: w.clone, env: w.env, stdout: "pipe", stderr: "pipe" });
    expect([signal, await child.exited]).toEqual([signal, code]);
    expect(state(w)?.phase).toBe("verify");
    expect(existsSync(join(dirOf(w), "lock"))).toBe(false);
    // rollback handles the interrupted run (continue would run the signalling step again, in this process).
    expect((await run(w, "rollback")).code).toBe(0);
    expect(state(w)).toBeNull();
  }
});
