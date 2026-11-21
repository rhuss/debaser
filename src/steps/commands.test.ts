import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expand } from "./commands";
import { installNeeded } from "./install";
import type { EffectiveRecipe } from "../recipes/types";

test("placeholders fill the output, the root and the tests to rerun", () => {
  const vars = { output: "/t/out/build", root: "/t" };
  expect(expand(["bun", "build.ts", "--outfile", "{output}"], vars)).toEqual(["bun", "build.ts", "--outfile", "/t/out/build"]);
  expect(expand(["bun", "test", "{tests}"], vars)).toEqual(["bun", "test"]);
  expect(expand(["bun", "test", "{tests}"], { ...vars, tests: ["a.test.ts", "b c.test.ts"] })).toEqual([
    "bun",
    "test",
    "a.test.ts",
    "b c.test.ts",
  ]);
  expect(expand(["sh", "-c", "cd {root} && bun test {tests}"], { ...vars, tests: ["b c.test.ts"] })).toEqual([
    "sh",
    "-c",
    "cd /t && bun test 'b c.test.ts'",
  ]);
});

test("install runs when nothing is installed yet, even with unchanged manifests", () => {
  const tree = mkdtempSync(join(tmpdir(), "debaser-install-")),
    git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: tree });
  git("init", "-q");
  git("-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "base");
  writeFileSync(join(tree, "package.json"), "{}\n");
  git("add", ".");
  git("-c", "user.name=T", "-c", "user.email=t@x", "commit", "-q", "-m", "pkg");
  const recipe = { install: { step: "install", triggers: ["package.json"], marker: "node_modules" } } as EffectiveRecipe;
  expect(installNeeded(tree, recipe, "HEAD")).toBe(true);
  mkdirSync(join(tree, "node_modules"));
  expect(installNeeded(tree, recipe, "HEAD")).toBe(false);
  expect(installNeeded(tree, recipe, "HEAD~1")).toBe(true);
  expect(installNeeded(tree, { ...recipe, install: undefined }, "HEAD~1")).toBe(false);
});
