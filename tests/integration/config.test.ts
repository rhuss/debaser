/** The configuration display (spec 002, US3): where the patch list, the local
 * recipe, each recipe layer and the build directory live. */
import { expect, setDefaultTimeout, test } from "bun:test";
import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as patchlist from "../../src/core/patchlist";
import { branch, commit, configureTree, dirOf, git, recipeText, run, runWith, stubSteps, treeOf, write, world } from "../support/world";

const unpainted = (text: string) => Bun.stripANSI(text);

setDefaultTimeout(180_000);

const real = (path: string) => realpathSync(path);

test("list and status start with the configuration header, before and after the first build", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  rmSync(join(dirOf(w), "recipe.toml"));
  // The default build directory, not created yet; no local recipe.
  const tree = `${real(w.root)}/clone-debaser`;
  for (const verb of ["list", "status"]) {
    const lines = (await run(w, verb)).out.split("\n");
    expect(lines[0]).toBe(`data    ${dirOf(w)}`);
    expect(lines[1]).toBe(`config  ${dirOf(w)}/patches.json  (local recipe: none)`);
    expect(lines[2]).toBe(`build   ${tree}  (not created yet)`);
  }
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  for (const verb of ["list", "status"]) {
    const lines = (await run(w, verb)).out.split("\n");
    expect(lines[0]).toBe(`data    ${dirOf(w)}`);
    expect(lines[1]).toBe(`config  ${dirOf(w)}/patches.json  (local recipe: ${dirOf(w)}/recipe.toml)`);
    expect(lines[2]).toBe(`build   ${tree}`);
  }
});

test("list --json and status --json carry the configuration paths", async () => {
  const w = world();
  configureTree(w, []);
  for (const verb of ["list", "status"]) {
    const config = JSON.parse((await run(w, verb, "--json")).out).config;
    expect(config.dir).toBe(dirOf(w));
    expect(config.patchList).toBe(join(dirOf(w), "patches.json"));
    expect(config.localRecipe).toBe(join(dirOf(w), "recipe.toml"));
    expect(config.tree.path).toBe(`${real(w.root)}/clone-debaser`);
    expect(config.tree.exists).toBe(false);
    expect(config.tree.recorded).toBe(false);
  }
});

test("recipe names each layer's source: built-in, the committed file at its upstream commit, and the local override", async () => {
  const w = world();
  commit(w.seed, { ".debaser/recipe.toml": recipeText({ steps: stubSteps }) }, "share a debaser recipe");
  git(w.seed, "push", "-q", "origin", "main");
  configureTree(w, []);
  const list = patchlist.load(dirOf(w))!;
  // A project with a built-in recipe, so every kind of layer is present.
  patchlist.save(dirOf(w), { ...list, upstream: { ...list.upstream, repo: "rtk-ai/rtk" } });
  expect((await runWith(w, { ask: () => "y" }, "trust")).code).toBe(0);
  const sha = git(w.clone, "rev-parse", "--short=7", "upstream/main"),
    shown = await run(w, "recipe");
  expect(shown.out.split("\n")[0]).toBe(
    `debaser recipe · generic:rust-cargo (built-in) < project:rtk-ai/rtk (built-in) < repo .debaser/recipe.toml at upstream ${sha} < local ${dirOf(w)}/recipe.toml`,
  );
  const json = JSON.parse((await run(w, "recipe", "--json")).out);
  expect(json.layerSources).toEqual({
    "generic:rust-cargo": { kind: "built-in" },
    "project:rtk-ai/rtk": { kind: "built-in" },
    [`repo:.debaser/recipe.toml@${sha}`]: { kind: "repo", path: ".debaser/recipe.toml", commit: sha },
    local: { kind: "local", path: join(dirOf(w), "recipe.toml") },
  });
  expect(json.config).toEqual(JSON.parse((await run(w, "list", "--json")).out).config);
});

test("a build names the build directory and the patch list once, in the plain log and the live view's log", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  const line = `build directory ${real(w.root)}/clone-debaser; patch list ${dirOf(w)}/patches.json`;
  const plain = await run(w, "build");
  expect(plain.code).toBe(0);
  expect(plain.err.split(line).length).toBe(2);
  const live = await runWith(w, { live: "inline", columns: 300, rows: 60 }, "build", "--verbose");
  expect(live.code).toBe(0);
  // The inline screen draws its log again when it ends: the line is there, as one log entry.
  expect(unpainted(live.out)).toContain(`debaser: ${line}\n`);
});

test("status shows the build directory's state: modified files, missing, or on another branch", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  write(treeOf(w), { "mine.txt": "tinkering\n" });
  const modified = await run(w, "status");
  expect(modified.out.split("\n")[2]).toEndWith("  (1 modified file)");
  expect(modified.out).toContain("  modified: mine.txt");
  expect(JSON.parse((await run(w, "status", "--json")).out).config.tree.modified).toEqual(["mine.txt"]);
  git(treeOf(w), "checkout", "-q", "--", "mine.txt");
  git(treeOf(w), "switch", "-q", "-c", "other");
  expect((await run(w, "status")).out.split("\n")[2]).toEndWith("  (on other, not debaser)");
  const json = JSON.parse((await run(w, "status", "--json")).out).config.tree;
  expect([json.exists, json.branch]).toEqual([true, "other"]);
  rmSync(treeOf(w), { recursive: true, force: true });
  expect((await run(w, "status")).out.split("\n")[2]).toEndWith("  (missing)");
  expect(JSON.parse((await run(w, "status", "--json")).out).config.tree.exists).toBe(false);
});

test("status in place says so", async () => {
  const w = world();
  configureTree(w, [], { tree: "." });
  expect((await run(w, "status")).out.split("\n")[2]).toBe(`build   ${real(w.clone)}  (in place)`);
});
