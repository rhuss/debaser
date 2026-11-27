/** The compiled single binary: it builds, runs from any directory with only git
 * around, and starts fast. The release workflow runs this file on each platform
 * as the platform check (FR-006): the version must match the tag (FR-002,
 * SC-003), the target must match the asset name (FR-004, FR-008), and the live
 * view must finish without a worker error (SC-004). */
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { branch, commit, configure, dirOf, git, recipeText, world, type World } from "../support/world";

setDefaultTimeout(300_000);
const root = join(import.meta.dir, "..", ".."),
  binary = join(root, "dist", "debaser");

beforeAll(() => {
  // The release workflow builds the binary it will publish and sets this flag
  // so the check runs against that exact file instead of a second build.
  if (process.env.DEBASER_BINARY_PREBUILT === "1") return;
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
  // A pre-release version carries a hyphen (the tag v0.2.0-rc.1 reports 0.2.0-rc.1).
  expect(version.out).toMatch(/^debaser \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\n$/);
  // The release check pins the tag's version: a binary reporting another version
  // must not be published (FR-002, SC-003). A prebuilt release run must carry it.
  const expected = process.env.DEBASER_EXPECTED_VERSION;
  if (process.env.DEBASER_BINARY_PREBUILT === "1") expect(expected).toBeTruthy();
  if (expected) expect(version.out).toBe(`debaser ${expected}\n`);
  // The release check also pins the platform: a runner label that resolves to
  // the wrong architecture must not produce a mislabeled asset (FR-004, FR-008).
  const target = process.env.DEBASER_EXPECTED_TARGET;
  if (target) {
    const arch = process.arch === "x64" ? "amd64" : process.arch;
    expect(`${process.platform}-${arch}`).toBe(target);
  }
  expect(debaser(null, "help").out).toContain("usage: debaser");
});

test("the compiled binary adds, builds and reports status in a test world", () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, []);
  const added = debaser(w, "add", "mine", "Mine");
  expect(added.code).toBe(0);
  expect(added.out).toBe("added mine: Mine\n");
  const rebuilt = debaser(w, "build");
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
  const args = process.platform === "darwin" ? ["script", "-q", "/dev/null", binary, "build"] : ["script", "-qec", `${binary} build`, "/dev/null"];
  const p = Bun.spawnSync(args, { cwd: w.clone, env: { ...w.env, TERM: "xterm-256color", NO_COLOR: "" }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const out = Bun.stripANSI(p.stdout.toString());
  expect(p.exitCode).toBe(0);
  // The worker drew the view and ended it in its card, not the plain fallback.
  expect(out).toContain("debaser build");
  expect(out).toContain("✓ built dist/widget-custom");
  expect(out).toContain("build done · artifact");
  // FR-006: a worker that failed must not be masked by a final success card.
  expect(out).not.toMatch(/worker[^\n]*(error|failed|crash)/i);
});

test("off a terminal, the binary refuses an untrusted project recipe with the --trust-recipe hint", () => {
  const w = world();
  commit(w.seed, { ".debaser/recipe.toml": recipeText() }, "share a debaser recipe");
  git(w.seed, "push", "-q", "origin", "main");
  configure(w, []);
  rmSync(join(dirOf(w), "recipe.toml"));
  const refused = debaser(w, "build");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("not trusted yet");
  expect(refused.err).toContain("or pass --trust-recipe");
});
