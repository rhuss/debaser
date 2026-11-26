import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeLayers, parseRecipe, resolveRecipe, type Layer } from "./resolve";
import { create } from "../core/patchlist";

const project = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-recipe-"));
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  return dir;
};
const list = (repo = "acme/widget", recipe?: string) => ({
  ...create({ repo, remote: "upstream", branch: "main" }),
  ...(recipe ? { recipe } : {}),
});
const resolve = (o: { checkout: string; repo?: string; recipe?: string; local?: string }) => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-dir-"));
  if (o.local !== undefined) writeFileSync(join(dir, "recipe.toml"), o.local);
  return resolveRecipe({ checkout: o.checkout, patchList: list(o.repo, o.recipe), dir });
};
const names = (r: { steps: { name: string }[] }) => r.steps.map(s => s.name);

test("the generic recipe is detected from the project's files, and several matches stop", () => {
  expect(resolve({ checkout: project({ "bun.lock": "" }) }).generic).toBe("bun-ts");
  expect(resolve({ checkout: project({ "bun.lockb": "" }) }).generic).toBe("bun-ts");
  expect(resolve({ checkout: project({ "Cargo.toml": "" }) }).generic).toBe("rust-cargo");
  expect(() => resolve({ checkout: project({ "bun.lock": "", "Cargo.toml": "" }) })).toThrow(
    "several generic recipes match this project: bun-ts, rust-cargo",
  );
  expect(() => resolve({ checkout: project({ "README.md": "" }) })).toThrow("no recipe matches this project; debaser has bun-ts, rust-cargo");
});

test("the recipe field wins over extends, which wins over detection", () => {
  const checkout = project({ "bun.lock": "" });
  expect(resolve({ checkout, recipe: "rust-cargo" }).generic).toBe("rust-cargo");
  expect(resolve({ checkout, local: 'extends = "rust-cargo"\n' }).generic).toBe("rust-cargo");
  expect(resolve({ checkout, recipe: "bun-ts", local: 'extends = "rust-cargo"\n' }).generic).toBe("bun-ts");
  expect(() => resolve({ checkout, recipe: "nope" })).toThrow("no generic recipe named nope");
});

test("steps merge by name, before and after place new ones, and steps_replace drops the inherited list", () => {
  const base: Layer = {
      id: "generic:x",
      recipe: parseRecipe('[[steps]]\nname = "a"\nrun = ["a"]\n[[steps]]\nname = "b"\nrun = ["b"]\n[[steps]]\nname = "c"\nrun = ["c"]\n', "x"),
    },
    top = (text: string): Layer => ({ id: "local", recipe: parseRecipe(text, "local") });
  const merged = mergeLayers([
    base,
    top(
      '[[steps]]\nname = "b"\nrun = ["B"]\n[[steps]]\nname = "x"\nrun = ["x"]\nbefore = "b"\n[[steps]]\nname = "y"\nrun = ["y"]\nafter = "c"\n[[steps]]\nname = "z"\nrun = ["z"]\n',
    ),
  ]);
  expect(names(merged)).toEqual(["a", "x", "b", "c", "y", "z"]);
  expect(merged.steps.find(s => s.name === "b")?.run).toEqual(["B"]);
  expect(merged.provenance["steps.b"]).toBe("local");
  expect(merged.provenance["steps.a"]).toBe("generic:x");
  const replaced = mergeLayers([base, top('steps_replace = true\n[[steps]]\nname = "only"\nrun = ["o"]\n')]);
  expect(names(replaced)).toEqual(["only"]);
  expect(() => mergeLayers([base, top('[[steps]]\nname = "q"\nrun = ["q"]\nbefore = "missing"\n')])).toThrow(
    "step q is placed before missing, which is not among the steps so far",
  );
});

test("a step's tests scope must be a non-empty list of strings", () => {
  const base = { id: "generic:x", recipe: parseRecipe('[[steps]]\nname = "t"\nrun = ["t"]\n', "x") };
  const top = (text: string) => ({ id: "local", recipe: parseRecipe(text, "recipe.toml") });
  expect(mergeLayers([base, top('[[steps]]\nname = "t"\nrun = ["t", "{tests}"]\ntests = ["src"]\n')]).steps[0].tests).toEqual(["src"]);
  expect(() => top('[[steps]]\nname = "t"\nrun = ["t"]\ntests = "src"\n')).toThrow("tests");
  expect(() => top('[[steps]]\nname = "t"\nrun = ["t"]\ntests = []\n')).toThrow("tests");
});

test("a higher layer's scalar and table values override the lower ones, and provenance names each layer", () => {
  const r = resolve({
    checkout: project({ "Cargo.toml": "" }),
    repo: "rtk-ai/rtk",
    local: '[artifact]\ninstall = "bin/rtk"\n',
  });
  expect(r.artifact).toEqual({ output: "target/release/rtk", install: "bin/rtk" });
  expect(r.provenance["artifact.output"]).toBe("project:rtk-ai/rtk");
  expect(r.provenance["artifact.install"]).toBe("local");
  expect(r.provenance["install.step"]).toBe("generic:rust-cargo");
  expect(r.layers).toEqual(["generic:rust-cargo", "project:rtk-ai/rtk", "local"]);
});

test("extends is allowed only in the lowest non-generic layer", () => {
  expect(() => resolve({ checkout: project({ "Cargo.toml": "" }), repo: "rtk-ai/rtk", local: 'extends = "bun-ts"\n' })).toThrow(
    "extends is only allowed in the lowest non-generic layer",
  );
});

test("the built-in project recipes resolve to the pilots' step orders", () => {
  const rtk = resolve({ checkout: project({}), repo: "rtk-ai/rtk" });
  expect(rtk.generic).toBe("rust-cargo");
  expect(names(rtk)).toEqual(["fetch", "fmt", "clippy", "test", "build"]);
  expect(rtk.steps.find(s => s.name === "test")?.parser).toBe("cargo-test");
  expect(rtk.artifact).toEqual({ output: "target/release/rtk", install: "dist/rtk-custom" });
  expect(rtk.install).toEqual({ step: "fetch", triggers: ["Cargo.lock", "Cargo.toml"] });
  const corgi = resolve({ checkout: project({}), repo: "tals/corgi" });
  expect(corgi.generic).toBe("bun-ts");
  expect(names(corgi)).toEqual(["install", "typecheck", "native", "test", "build"]);
  expect(corgi.steps.find(s => s.name === "typecheck")?.run).toEqual(["bun", "typecheck.ts"]);
  // corgi's unit tests need a longer per-test timeout than bun's default.
  // Only the unit tests in src/ on a full run: the end-to-end tests in tests/ need a built test binary.
  expect(corgi.steps.find(s => s.name === "test")).toMatchObject({
    run: ["bun", "test", "{tests}", "--timeout", "60000"],
    parser: "bun-test",
    tests: ["src"],
  });
  expect(corgi.artifact?.install).toBe("dist/corgi-custom");
  expect(corgi.afterBuild).toEqual(["./dist/corgi-custom", "reload"]);
  expect(corgi.projectName).toBe("corgi");
  expect(resolve({ checkout: project({ "bun.lock": "" }) }).projectName).toBe("widget");
});

test("a TOML syntax error and an unknown key are refused, naming the file and key", () => {
  const checkout = project({ "bun.lock": "" });
  expect(() => resolve({ checkout, local: "steps = [" })).toThrow("recipe.toml");
  expect(() => resolve({ checkout, local: 'version = 2\n' })).toThrow("recipe.toml: unknown key version");
  expect(() => resolve({ checkout, local: '[[steps]]\nname = "a"\nrun = ["a"]\ncolour = "red"\n' })).toThrow(
    "recipe.toml: unknown key steps[0].colour",
  );
  expect(() => parseRecipe('[artifact]\noutput = 3\n', "x.toml")).toThrow("x.toml: artifact.output must be a string");
  expect(() => parseRecipe('[[steps]]\nname = "t"\nrun = ["t"]\nparser = "bun-tset"\n', "x.toml")).toThrow(
    "x.toml: steps[0].parser names no failure parser",
  );
});

test("a local override alone is a recipe; no generic is needed then", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-dir-")),
    checkout = project({});
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "recipe.toml"), 'steps_replace = true\n[[steps]]\nname = "t"\nrun = ["true"]\n');
  const r = resolveRecipe({ checkout, patchList: list(), dir });
  expect(r.generic).toBeNull();
  expect(names(r)).toEqual(["t"]);
});

test("a higher layer's [install] keys merge one by one over the lower layer's", () => {
  const r = resolve({ checkout: project({ "bun.lock": "" }), local: '[install]\nmarker = ".installed"\n' });
  expect(r.install).toEqual({ step: "install", triggers: ["bun.lock", "package.json"], marker: ".installed" });
  expect(r.provenance["install.marker"]).toBe("local");
  expect(r.provenance["install.triggers"]).toBe("generic:bun-ts");
});
