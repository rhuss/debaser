/** The compiled single binary (FR-051, SC-005): it builds, runs from any
 * directory with only git and gh around, and starts fast. */
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { branch, commit, configure, dirOf, git, recipeText, world, type World } from "../support/world";

setDefaultTimeout(300_000);
const root = join(import.meta.dir, "..", ".."),
  binary = join(root, "dist", "debaser");

beforeAll(() => {
  const built = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  // bun build leaves temporary files beside the project while it compiles.
  for (const name of Bun.spawnSync(["sh", "-c", "ls -a | grep '\\.bun-build$' || true"], { cwd: root }).stdout.toString().split("\n").filter(Boolean))
    rmSync(join(root, name), { force: true });
  if (built.exitCode !== 0) throw Error(`bun run build failed: ${built.stderr.toString()}`);
});
function debaser(w: World | null, ...args: string[]) {
  const p = Bun.spawnSync([binary, ...args], {
    cwd: w?.clone ?? root,
    env: w ? w.env : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

test("the compiled binary prints its version and usage", () => {
  expect(existsSync(binary)).toBe(true);
  const version = debaser(null, "--version");
  expect(version.code).toBe(0);
  expect(version.out).toMatch(/^debaser \d+\.\d+\.\d+\n$/);
  expect(debaser(null, "help").out).toContain("usage: debaser");
});

test("the compiled binary adds, rebuilds and reports status in a test world", () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, []);
  const added = debaser(w, "add", "mine", "Mine");
  expect(added.code).toBe(0);
  expect(added.out).toBe("added mine: Mine\n");
  const rebuilt = debaser(w, "rebuild");
  expect(rebuilt.code).toBe(0);
  expect(rebuilt.out).toContain("debaser: built dist/widget-custom");
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
  const status = debaser(w, "status", "--json");
  expect(status.code).toBe(0);
  expect(JSON.parse(status.out).patches.map((p: { display: string }) => p.display)).toEqual(["mine"]);
  // The built-in recipes travel inside the binary.
  writeFileSync(join(dirOf(w), "recipe.toml"), 'recipe = "rust-cargo"\n');
  const recipe = debaser(w, "recipe", "--json");
  expect(recipe.code).toBe(0);
  expect(JSON.parse(recipe.out).steps.map((s: { name: string }) => s.name)).toContain("fetch");
  expect(readFileSync(join(dirOf(w), "patches.json"), "utf8")).toContain('"name": "mine"');
});

test("a warm start of the compiled binary takes under 100 ms", () => {
  debaser(null, "--version");
  const times = [0, 1, 2].map(() => {
    const started = performance.now();
    debaser(null, "--version");
    return performance.now() - started;
  });
  expect(Math.min(...times)).toBeLessThan(100);
});

test("the live view's worker starts from the binary under a pseudo terminal", () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  const args = process.platform === "darwin" ? ["script", "-q", "/dev/null", binary, "rebuild"] : ["script", "-qec", `${binary} rebuild`, "/dev/null"];
  const p = Bun.spawnSync(args, { cwd: w.clone, env: { ...w.env, TERM: "xterm-256color", NO_COLOR: "" }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const out = Bun.stripANSI(p.stdout.toString());
  expect(p.exitCode).toBe(0);
  // The worker drew the view and ended it in its card, not the plain fallback.
  expect(out).toContain("debaser rebuild");
  expect(out).toContain("✓ built dist/widget-custom");
  expect(out).toContain("rebuild done · artifact");
});

test("off a terminal, the binary refuses an untrusted project recipe with the --trust-recipe hint", () => {
  const w = world();
  commit(w.seed, { ".debaser/recipe.toml": recipeText() }, "share a debaser recipe");
  git(w.seed, "push", "-q", "origin", "main");
  configure(w, []);
  rmSync(join(dirOf(w), "recipe.toml"));
  const refused = debaser(w, "rebuild");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("not trusted yet");
  expect(refused.err).toContain("or pass --trust-recipe");
});
