import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as runstate from "../../src/core/runstate";
import { paths } from "../../src/core/paths";
import { branch, configureOwn, conflicting, configure, dirOf, git, latest, run, write, world } from "../support/world";

setDefaultTimeout(120_000);

/** Rewrites a JSON file in place. */
function edit(path: string, change: (json: Record<string, unknown>) => void): void {
  const json = JSON.parse(readFileSync(path, "utf8"));
  change(json);
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

test("the old rebuild command is gone", async () => {
  const w = world();
  configure(w, []);
  const old = await run(w, "rebuild");
  expect(old.code).toBe(1);
  expect(old.err + old.out).toContain("unknown command rebuild");
});

test("a run stopped by a version that called it rebuild still continues", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  edit(paths.run(dirOf(w)), json => void (json.kind = "rebuild"));
  expect(runstate.loadRun(dirOf(w))?.kind).toBe("build");
  write(w.clone, { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(w.clone, "add", "base.txt");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(JSON.parse(readFileSync(join(latest(w), "result.json"), "utf8")).command).toBe("build");
});

test("status reads the results of a build recorded as rebuild", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureOwn(w, ["mine"], { patchExtra: { mine: { acceptance: { run: ["true"] } } } });
  expect((await run(w, "build")).code).toBe(0);
  edit(join(latest(w), "result.json"), json => void (json.command = "rebuild"));
  const text = await run(w, "status");
  expect(text.code).toBe(0);
  expect(text.out).toMatch(/^mine +.* not a PR +\S+ +pass +pass/m);
});
