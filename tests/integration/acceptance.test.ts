import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AcceptanceCheck } from "../../src/core/patchlist";
import {
  branch,
  commit,
  configure,
  dirOf,
  fresh,
  git,
  handoffs,
  installPath,
  latest,
  read,
  run,
  state,
  stubHarness,
  stubSteps,
  upstreamMoves,
  world,
  type World,
} from "../support/world";

setDefaultTimeout(120_000);

const results = (w: World) =>
  Object.fromEntries(
    JSON.parse(read(join(latest(w), "result.json"))).patches.map((p: { display: string; acceptance: string }) => [p.display, p.acceptance]),
  );
const check = (run: string[], extra: Partial<AcceptanceCheck> = {}): AcceptanceCheck => ({ run, ...extra });

test("acceptance checks pass or fail by exit code and output pattern, from the tree root with DEBASER_ARTIFACT", async () => {
  const w = world();
  branch(w, "good", { "good.txt": "good\n" });
  branch(w, "plain", { "plain.txt": "plain\n" });
  const seen = join(fresh("seen"), "env");
  configure(w, ["good", "plain"], {
    patchExtra: {
      good: {
        acceptance: check(["sh", "-c", `pwd > ${seen}; echo "$DEBASER_ARTIFACT" >> ${seen}; test -f good.txt && echo "widget 1.2" >&2`], {
          match: "widget \\d+\\.\\d+",
        }),
      },
    },
  });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  const [cwd, artifact] = read(seen).trim().split("\n");
  expect(realpathSync(cwd)).toBe(realpathSync(w.clone));
  expect(artifact).toBe(join(realpathSync(w.clone), "out", "build"));
  expect(results(w)).toEqual({ good: "pass", plain: "unverified" });
  expect(result.out).toContain("unverified: plain (no acceptance check)");
  expect(read(join(latest(w), "acceptance", "good.log"))).toContain("widget 1.2");
  expect(read(join(latest(w), "report.md"))).toContain("## Acceptance checks\n\n- good: pass\n- plain: unverified\n");
  expect(state(w)).toBeNull();
});

test("a failing acceptance check without a harness stops with 6, blames only its patch, and keeps the installed build", async () => {
  const w = world();
  branch(w, "good", { "good.txt": "good\n" });
  configure(w, ["good"]);
  expect((await run(w, "build")).code).toBe(0);
  const installed = read(installPath(w));
  branch(w, "bad", { "bad.txt": "bad\n" });
  branch(w, "other", { "other.txt": "other\n" });
  configure(w, ["good", "bad", "other"], {
    patchExtra: {
      bad: { acceptance: check(["sh", "-c", "echo 'version 0.9'"], { match: "version 1\\." }) },
      other: { acceptance: check(["sh", "-c", "exit 3"], { exit: 3 }) },
    },
  });
  const stopped = await run(w, "build");
  expect(stopped.code).toBe(6);
  expect(stopped.out).toContain("the acceptance check of bad fails");
  expect(handoffs(w)).toEqual(["bad.md"]);
  const handoff = read(join(latest(w), "handoffs", "bad.md"));
  expect(handoff).toContain("- Kind: acceptance\n");
  expect(handoff).toContain("version 0.9");
  // The installed build is the last good one.
  expect(read(installPath(w))).toBe(installed);
  expect(state(w)?.phase).toBe("accept");
  expect(results(w)).toMatchObject({ good: "unverified", bad: "fail", other: "pass" });
});

test("an acceptance check that fails once and passes when run again is flaky", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  const tried = join(fresh("flaky"), "tried");
  configure(w, ["a"], { patchExtra: { a: { acceptance: check(["sh", "-c", `test -f "${tried}" || { touch "${tried}"; false; }`]) } } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(results(w)).toEqual({ a: "flaky" });
  expect(result.out).toContain("warning: the acceptance check of a failed once and passed when run again; it may be flaky");
});

test("an acceptance check past its timeout fails", async () => {
  const w = world();
  branch(w, "slow", { "slow.txt": "slow\n" });
  configure(w, ["slow"], { patchExtra: { slow: { acceptance: check(["sleep", "30"], { timeout: 1 }) } } });
  const started = Date.now(),
    result = await run(w, "build");
  expect(result.code).toBe(6);
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(read(join(latest(w), "acceptance", "slow.log"))).toContain("timed out");
});

test("a harness fix for an acceptance check reruns every step, builds and reruns the checks", async () => {
  const w = world();
  branch(w, "feature", { "feature.txt": "off\n" });
  const builds = join(fresh("builds"), "count"),
    h = stubHarness(`echo "$DEBASER_TASK" >> "$(dirname "$0")/tasks"; cp "$1" "$(dirname "$0")/prompt"; echo on > feature.txt`);
  configure(w, ["feature"], {
    harness: { command: h.command },
    steps: stubSteps.map(s => (s.name === "build" ? { ...s, run: ["sh", "-c", `echo x >> ${builds}; ${s.run[2]}`, ...s.run.slice(3)] } : s)),
    patchExtra: { feature: { acceptance: check(["sh", "-c", "grep -q on feature.txt"]) } },
  });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(1);
  expect(read(join(h.bin, "tasks"))).toBe("acceptance\n");
  expect(read(join(h.bin, "prompt"))).toContain("- Patch: feature");
  expect(git(w.clone, "log", "-1", "--format=%B")).toBe("debaser: fix acceptance feature (agent)\n\nFixed-By: harness");
  expect(read(builds).trim().split("\n").length).toBe(2);
  expect(results(w)).toEqual({ feature: "fixed" });
  expect(handoffs(w)).toEqual(["feature.md"]);
});

test("a harness that can't fix an acceptance check ends with 5, and acceptance fixes count toward the fix bound", async () => {
  const w = world();
  branch(w, "feature", { "feature.txt": "off\n" });
  const idle = stubHarness("true");
  configure(w, ["feature"], { harness: { command: idle.command, attempts: 2 }, patchExtra: { feature: { acceptance: check(["false"]) } } });
  const exhausted = await run(w, "build");
  expect(exhausted.code).toBe(5);
  expect(idle.calls()).toBe(2);
  expect(exhausted.out).toContain("the harness could not fix the acceptance check of feature in 2 attempts");
  // continue asks the harness again with a fresh set of attempts (US3-5).
  const again = await run(w, "continue");
  expect(again.code).toBe(5);
  expect(idle.calls()).toBe(4);

  // One attempt per problem, four steps and one check: five fixes in all. Each
  // step needs one fix; the acceptance fix then breaks typecheck, past the bound.
  const v = world();
  branch(v, "four", { "a.txt": "INSTALLX\n", "b.txt": "BROKEN\n", "c.txt": "FAILTEST\n", "d.txt": "BUILDX\n" });
  const fails = (marker: string) => ["sh", "-c", `! grep -rqs ${marker} --include=*.txt .`];
  const busy = stubHarness(
    'for m in INSTALLX BROKEN FAILTEST BUILDX; do f=$(grep -rls --include=*.txt "$m" . | head -1); if [ -n "$f" ]; then echo fine > "$f"; exit 0; fi; done; echo ok > accepted.txt; echo BROKEN > brk.txt',
  );
  configure(v, ["four"], {
    harness: { command: busy.command, attempts: 1 },
    steps: [
      { name: "install", run: fails("INSTALLX") },
      { name: "typecheck", run: fails("BROKEN") },
      { name: "test", run: fails("FAILTEST") },
      { name: "build", run: ["sh", "-c", '! grep -rqs BUILDX --include=*.txt . && mkdir -p "$(dirname "$1")" && touch "$1"', "build", "{output}"] },
    ],
    patchExtra: { four: { acceptance: check(["test", "-f", "accepted.txt"]) } },
  });
  const bounded = await run(v, "build");
  expect(bounded.code).toBe(5);
  expect(busy.calls()).toBe(5);
  expect(bounded.out).toContain("typecheck fails again after the harness's 5 fixes");
});

test("an invalid acceptance pattern is refused when the patch list loads, naming the patch", async () => {
  const w = world();
  configure(w, ["mine"], { patchExtra: { mine: { acceptance: check(["true"], { match: "(" }) } } });
  const result = await run(w, "list");
  expect(result.code).toBe(1);
  expect(result.err).toContain("patches[0] (mine): acceptance.match is not a valid regular expression");
});

test("a patch skipped as merged or contained runs no acceptance check and is reported as skipped", async () => {
  const w = world();
  const lower = branch(w, "lower", { "lower.txt": "lower\n" });
  void lower;

  git(w.seed, "fetch", "-q", join(w.clone), "lower");
  git(w.seed, "merge", "-q", "--no-edit", "FETCH_HEAD");
  git(w.seed, "push", "-q", "origin", "main");
  const ran = join(fresh("ran"), "ran");
  configure(w, ["lower"], { patchExtra: { lower: { acceptance: check(["sh", "-c", `touch ${ran}`]) } } });
  expect((await run(w, "build")).code).toBe(0);
  expect(existsSync(ran)).toBe(false);
  expect(results(w)).toEqual({ lower: "skipped" });
});

test("continue after an acceptance stop commits the user's fix and checks again", async () => {
  const w = world();
  branch(w, "feature", { "feature.txt": "off\n" });
  configure(w, ["feature"], { patchExtra: { feature: { acceptance: check(["sh", "-c", "grep -q on feature.txt"]) } } });
  expect((await run(w, "build")).code).toBe(6);
  writeFileSync(join(w.clone, "feature.txt"), "on\n");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(git(w.clone, "log", "-1", "--format=%s")).toBe("debaser: fix acceptance feature (user)");
  expect(results(w)).toEqual({ feature: "pass" });
  void commit;
  void dirOf;
});

test("a fix that leaves an acceptance check failing uses up one of its attempts", async () => {
  const w = world();
  branch(w, "feature", { "feature.txt": "off\n" });
  const h = stubHarness("echo x >> tries.txt");
  configure(w, ["feature"], { harness: { command: h.command, attempts: 2 }, patchExtra: { feature: { acceptance: check(["false"]) } } });
  const result = await run(w, "build");
  expect(result.code).toBe(5);
  expect(h.calls()).toBe(2);
  expect(result.out).toContain("in 2 attempts");
});
