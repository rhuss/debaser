/** The build directory (spec 002): builds, stops, continue and rollback work in
 * `../clone-debaser`, never in the checkout debaser was started from. */
import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as patchlist from "../../src/core/patchlist";
import * as runstate from "../../src/core/runstate";
import * as gitTool from "../../src/git/git";
import { mainWorktree, removeWorktree, worktreeAt } from "../../src/git/worktree";
import {
  branch,
  commit,
  configureTree,
  conflicting,
  dirOf,
  fixBroken,
  fresh,
  git,
  handoffs,
  latest,
  read,
  run,
  runWith,
  state,
  stubHarness,
  stubSteps,
  treeInstallPath,
  treeOf,
  upstreamMoves,
  write,
  world,
  type World,
} from "../support/world";

setDefaultTimeout(180_000);

const real = (path: string) => realpathSync(path);
/** The patch list as written on disk. */
const listed = (w: World) => JSON.parse(readFileSync(join(dirOf(w), "patches.json"), "utf8"));
/** What a build must leave alone in a checkout: its branch, HEAD, its changes
 * with their contents, and its ignored files (build output, installs). */
const checkoutState = (cwd: string) => [
  git(cwd, "branch", "--show-current"),
  git(cwd, "rev-parse", "HEAD"),
  git(cwd, "status", "--porcelain", "--ignored"),
  git(cwd, "diff", "HEAD"),
];

test("mainWorktree and worktreeAt read git's worktree list from any worktree", () => {
  const w = world(),
    other = join(w.root, "other");
  git(w.clone, "worktree", "add", "-q", "-b", "side", other);
  expect(mainWorktree(other)).toBe(real(w.clone));
  expect(worktreeAt(w.clone, other)).toEqual({ branch: "side", locked: false });
  expect(worktreeAt(w.clone, join(w.root, "nowhere"))).toBeNull();
  git(other, "checkout", "-q", "--detach");
  expect(worktreeAt(w.clone, other)).toEqual({ branch: null, locked: false });
  rmSync(other, { recursive: true, force: true });
  // A deleted worktree stays registered until it is pruned.
  expect(worktreeAt(w.clone, other)).toEqual({ branch: null, locked: false });
});

test("removeWorktree never drops a locked registration, even when its directory is away", () => {
  const w = world(),
    away = join(w.root, "away");
  git(w.clone, "worktree", "add", "-q", "--detach", away);
  git(w.clone, "worktree", "lock", "--reason", "on a removable volume", away);
  rmSync(away, { recursive: true, force: true });
  expect(worktreeAt(w.clone, away)).toEqual({ branch: null, locked: true });
  removeWorktree(w.clone, away);
  expect(worktreeAt(w.clone, away)).toEqual({ branch: null, locked: true });
});

// US1

test("a build leaves a dirty main checkout on a feature branch exactly as it was", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  git(w.clone, "checkout", "-q", "-b", "feature");
  write(w.clone, { "base.txt": "my edit\n" });
  const before = checkoutState(w.clone);
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(checkoutState(w.clone)).toEqual(before);
  expect(git(treeOf(w), "branch", "--show-current")).toBe("debaser");
});

test("the first build creates the build directory beside the main checkout and records it", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect(listed(w).tree).toBeUndefined();
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(result.err).toContain(`creating the build directory ${real(w.root)}/clone-debaser from upstream/main`);
  expect(git(treeOf(w), "branch", "--show-current")).toBe("debaser");
  expect(listed(w).tree).toBe("../clone-debaser");
  // The build output, the merged patches and the installed artifact live there, not in the checkout.
  expect(read(join(treeOf(w), "mine.txt"))).toBe("mine\n");
  expect(existsSync(join(treeOf(w), "out", "build"))).toBe(true);
  expect(existsSync(treeInstallPath(w))).toBe(true);
  expect(existsSync(join(w.clone, "dist", "widget-custom"))).toBe(false);
  expect(existsSync(join(w.clone, "mine.txt"))).toBe(false);
  // result.json names the build directory (FR-020).
  expect(JSON.parse(read(join(latest(w), "result.json"))).tree).toBe(real(treeOf(w)));
});

test("builds started from the build directory and from a third worktree build in the same place", async () => {
  const w = world(),
    third = join(w.root, "third");
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  const built = git(w.clone, "rev-parse", "debaser^{tree}");
  expect((await runWith(w, { cwd: treeOf(w) }, "build")).code).toBe(0);
  expect(git(w.clone, "rev-parse", "debaser^{tree}")).toBe(built);
  git(w.clone, "worktree", "add", "-q", "--detach", third, "main");
  const before = checkoutState(third);
  const result = await runWith(w, { cwd: third }, "build");
  expect(result.code).toBe(0);
  expect(result.err).toContain(`build directory ${real(treeOf(w))}; patch list `);
  expect(git(w.clone, "rev-parse", "debaser^{tree}")).toBe(built);
  expect(checkoutState(third)).toEqual(before);
  expect(existsSync(join(third, "mine.txt"))).toBe(false);
  expect(git(treeOf(w), "rev-parse", "HEAD")).toBe(git(w.clone, "rev-parse", "debaser"));
});

test("a build rebasing own branches leaves an own branch checked out in the main checkout alone", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureTree(w, ["mine"], { rebase: undefined });
  git(w.clone, "checkout", "-q", "mine");
  write(w.clone, { "mine.txt": "editing\n" });
  const before = checkoutState(w.clone);
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(checkoutState(w.clone)).toEqual(before);
  expect(read(join(treeOf(w), "mine.txt"))).toBe("mine\n");
});

test("a refusal before the run leaves no build directory and records nothing", async () => {
  const w = world();
  branch(w, "debaser-prev", { "prev.txt": "prev\n" });
  configureTree(w, ["debaser-prev"]);
  const result = await run(w, "build");
  expect(result.code).toBe(1);
  expect(result.err).toContain("is a branch debaser resets");
  expect(existsSync(treeOf(w))).toBe(false);
  expect(listed(w).tree).toBeUndefined();
});

test("the first build in a new build directory installs; later builds install only when a trigger changed (SC-004)", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  const count = join(fresh("installs"), "count");
  configureTree(w, ["mine"], {
    install: { step: "install", triggers: ["package.json"], marker: "installed.marker" },
    steps: [{ name: "install", run: ["sh", "-c", `touch installed.marker; echo x >> "${count}"`] }, ...stubSteps.filter(s => s.name !== "install")],
  });
  expect((await run(w, "build")).code).toBe(0);
  expect(read(count)).toBe("x\n");
  expect(existsSync(join(treeOf(w), "installed.marker"))).toBe(true);
  expect(existsSync(join(w.clone, "installed.marker"))).toBe(false);
  expect((await run(w, "build")).code).toBe(0);
  expect(read(count)).toBe("x\n");
  commit(w.seed, { "package.json": '{"name":"widget"}\n' }, "deps change");
  git(w.seed, "push", "-q", w.upstream, "HEAD:main");
  expect((await run(w, "build")).code).toBe(0);
  expect(read(count)).toBe("x\nx\n");
});

test("a recipe with install triggers but no marker still installs in a new build directory, then only on a trigger change", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  const count = join(fresh("installs"), "count");
  configureTree(w, ["mine"], {
    install: { step: "install", triggers: ["package.json"] },
    steps: [{ name: "install", run: ["sh", "-c", `echo x >> "${count}"`] }, ...stubSteps.filter(s => s.name !== "install")],
  });
  expect((await run(w, "build")).code).toBe(0);
  expect(read(count)).toBe("x\n");
  expect(state(w)).toBeNull();
  expect((await run(w, "build")).code).toBe(0);
  expect(read(count)).toBe("x\n");
  // Deleted by hand: the recreated directory has nothing installed either.
  rmSync(treeOf(w), { recursive: true, force: true });
  expect((await run(w, "build")).code).toBe(0);
  expect(read(count)).toBe("x\nx\n");

  // A first build that fails after creating the directory, before any install
  // (a patch that can't be fetched), leaves nothing installed: the next build installs.
  const v = world(),
    vcount = join(fresh("installs"), "count");
  const noMarker = {
    install: { step: "install", triggers: ["package.json"] },
    steps: [{ name: "install", run: ["sh", "-c", `echo x >> "${vcount}"`] }, ...stubSteps.filter(s => s.name !== "install")],
  };
  configureTree(v, ["gone"], noMarker);
  expect((await run(v, "build")).code).not.toBe(0);
  expect(existsSync(treeOf(v))).toBe(true);
  expect(existsSync(vcount)).toBe(false);
  branch(v, "mine", { "mine.txt": "mine\n" });
  configureTree(v, ["mine"], { tree: "../clone-debaser", ...noMarker });
  expect((await run(v, "build")).code).toBe(0);
  expect(read(vcount)).toBe("x\n");
});

test("a build directory that is a locked, absent worktree is refused and its registration kept", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  git(w.clone, "worktree", "lock", "--reason", "on a removable volume", treeOf(w));
  rmSync(treeOf(w), { recursive: true, force: true });
  const before = untouched(w);
  const refused = await run(w, "build");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain(`is a locked worktree that is not there; bring it back, or unlock it: git worktree unlock`);
  expect(worktreeAt(w.clone, treeOf(w))).toEqual({ branch: "debaser", locked: true });
  expect(untouched(w)).toEqual(before);
});

test("rollback of a stopped run whose build directory is a locked, absent worktree refuses and keeps everything", async () => {
  const w = world();
  conflicting(w);
  configureTree(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  git(w.clone, "worktree", "lock", treeOf(w));
  rmSync(treeOf(w), { recursive: true, force: true });
  const before = untouched(w),
    stopped = state(w)!;
  const refused = await run(w, "rollback");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("is a locked worktree that is not there; bring it back, or unlock it: git worktree unlock");
  expect(state(w)!.phase).toBe(stopped.phase);
  expect(worktreeAt(w.clone, treeOf(w))?.locked).toBe(true);
  expect(untouched(w)).toEqual(before);
});

test("rollback without a run restores the installed artifact's backup in the build directory", async () => {
  const w = world();
  branch(w, "one", { "one.txt": "one\n" });
  branch(w, "two", { "two.txt": "two\n" });
  configureTree(w, ["one"]);
  expect((await run(w, "build")).code).toBe(0);
  const first = read(treeInstallPath(w));
  configureTree(w, ["one", "two"], { tree: "../clone-debaser" });
  expect((await run(w, "build")).code).toBe(0);
  expect(read(treeInstallPath(w))).not.toBe(first);
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(read(treeInstallPath(w))).toBe(first);
  expect(git(treeOf(w), "rev-parse", "HEAD")).toBe(git(w.clone, "rev-parse", "debaser"));
  expect(existsSync(join(w.clone, "dist"))).toBe(false);
});

// US2

test("stops name the build directory: the stop lines, the agent prompts and the handoffs", async () => {
  // A patch that conflicts with upstream stops the merge and gets a handoff.
  const w = world();
  branch(w, "stale", { "base.txt": "one\nSTALE\nthree\n" });
  upstreamMoves(w, { "base.txt": "one\nUPSTREAM\nthree\n" });
  configureTree(w, ["stale"]);
  const stopped = await run(w, "build");
  expect(stopped.code).toBe(2);
  const tree = real(treeOf(w));
  expect(stopped.out).toContain(`  build directory: ${tree}\n`);
  expect(stopped.out).toContain(`run it: cd ${tree} && `);
  expect(read(join(latest(w), "fix-conflict.md"))).toContain(`You are working in the build directory ${tree}.`);
  expect(handoffs(w)).toEqual(["stale.md"]);
  expect(read(join(latest(w), "handoffs", "stale.md"))).toContain(`- Build directory: ${tree}\n`);

  const v = world();
  branch(v, "bad", { "bad.txt": "BROKEN\n" });
  configureTree(v, ["bad"]);
  const failed = await run(v, "build");
  expect(failed.code).toBe(3);
  const vtree = real(treeOf(v));
  expect(failed.out).toContain(`  build directory: ${vtree}\n`);
  expect(failed.out).toContain(`run it: cd ${vtree} && `);
  expect(read(join(latest(v), "fix-typecheck.md"))).toContain(`You are working in the build directory ${vtree}.`);
});

test("a conflict resolved in the build directory continues from the main checkout", async () => {
  const w = world();
  conflicting(w);
  configureTree(w, ["left", "right"]);
  git(w.clone, "checkout", "-q", "-b", "feature");
  const before = checkoutState(w.clone);
  expect((await run(w, "build")).code).toBe(2);
  // Still conflicted: continue refuses and points at the build directory.
  const early = await run(w, "continue");
  expect(early.code).toBe(2);
  expect(early.out).toContain(`  build directory: ${real(treeOf(w))}`);
  write(treeOf(w), { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(treeOf(w), "add", "base.txt");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(read(join(treeOf(w), "base.txt"))).toBe("one\nLEFT and RIGHT\nthree\n");
  expect(checkoutState(w.clone)).toEqual(before);
});

test("rollback of a stopped run refuses a build directory switched to another branch, and switches nothing", async () => {
  const w = world();
  conflicting(w);
  configureTree(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  git(treeOf(w), "merge", "--abort");
  git(treeOf(w), "switch", "-q", "-c", "other");
  const refused = await run(w, "rollback");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain(`has other checked out, not debaser; switch it back first`);
  expect(git(treeOf(w), "branch", "--show-current")).toBe("other");
  expect(state(w)?.phase).toBe("merge");
  git(treeOf(w), "switch", "-q", "debaser");
  expect((await run(w, "rollback")).code).toBe(0);
  expect(state(w)).toBeNull();
});

test("rollback of a stopped run resets the build directory and leaves the main checkout alone", async () => {
  const w = world();
  conflicting(w);
  configureTree(w, ["left"]);
  expect((await run(w, "build")).code).toBe(0);
  const first = git(w.clone, "rev-parse", "debaser");
  configureTree(w, ["left", "right"], { tree: "../clone-debaser" });
  git(w.clone, "checkout", "-q", "-b", "feature");
  write(w.clone, { "base.txt": "my edit\n" });
  const before = checkoutState(w.clone);
  expect((await run(w, "build")).code).toBe(2);
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(git(w.clone, "rev-parse", "debaser")).toBe(first);
  expect(git(treeOf(w), "rev-parse", "HEAD")).toBe(first);
  expect(git(treeOf(w), "status", "--porcelain")).toBe("");
  expect(checkoutState(w.clone)).toEqual(before);

  // After a first run, rollback deletes the integration branch.
  const v = world();
  conflicting(v);
  configureTree(v, ["left", "right"]);
  expect((await run(v, "build")).code).toBe(2);
  expect((await run(v, "rollback")).code).toBe(0);
  expect(gitTool.branchExists(v.clone, "debaser")).toBe(false);
  expect(git(v.clone, "branch", "--show-current")).toBe("main");
  // The build directory stays, detached, ready for the next build.
  expect(existsSync(treeOf(v))).toBe(true);
  expect((await run(v, "build")).code).toBe(2);
});

test("a harness fix for a failing step is made and committed in the build directory", async () => {
  const w = world();
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const h = stubHarness(`pwd > "$(dirname "$0")/cwd"\n${fixBroken}`);
  configureTree(w, ["bad"], { harness: { command: h.command } });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(real(read(join(h.bin, "cwd")).trim())).toBe(real(treeOf(w)));
  expect(git(treeOf(w), "log", "-1", "--format=%B")).toBe("debaser: fix typecheck (agent)\n\nFixed-By: harness");
  expect(read(join(treeOf(w), "bad.txt"))).toBe("fixed\n");
  expect(git(w.clone, "status", "--porcelain")).toBe("");
});

test("an acceptance check runs in the build directory against its build output", async () => {
  const w = world();
  branch(w, "feature", { "feature.txt": "feature\n" });
  configureTree(w, ["feature"], {
    patchExtra: { feature: { acceptance: { run: ["sh", "-c", 'pwd > "$1.cwd"; test -s "$DEBASER_ARTIFACT"', "check", "{output}"] } } },
  });
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(real(read(join(treeOf(w), "out", "build.cwd")).trim())).toBe(real(treeOf(w)));
});

test("with the build directory deleted during a stop, continue points at rollback, which undoes the run without it", async () => {
  const w = world();
  conflicting(w);
  configureTree(w, ["left"]);
  expect((await run(w, "build")).code).toBe(0);
  const first = git(w.clone, "rev-parse", "debaser");
  configureTree(w, ["left", "right"], { tree: "../clone-debaser" });
  expect((await run(w, "build")).code).toBe(2);
  rmSync(treeOf(w), { recursive: true, force: true });
  const refused = await run(w, "continue");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain(`the build directory ${real(w.root)}/clone-debaser is gone; undo the run with \`debaser rollback\``);
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(git(w.clone, "rev-parse", "debaser")).toBe(first);
  expect(state(w)).toBeNull();
  const again = await run(w, "build");
  expect(again.err).toContain("creating the build directory");
  expect(existsSync(treeOf(w))).toBe(true);

  // After a first run, rollback deletes the branch.
  const v = world();
  conflicting(v);
  configureTree(v, ["left", "right"]);
  expect((await run(v, "build")).code).toBe(2);
  rmSync(treeOf(v), { recursive: true, force: true });
  expect((await run(v, "rollback")).code).toBe(0);
  expect(gitTool.branchExists(v.clone, "debaser")).toBe(false);
  expect(state(v)).toBeNull();
});

// US4

/** The patch list as an older debaser wrote it: no build directory recorded. */
function forgetTree(w: World) {
  const list = patchlist.load(dirOf(w))!;
  delete list.tree;
  patchlist.save(dirOf(w), list);
}
/** A run state as an older debaser wrote it: no build directory. */
function forgetRunTree(w: World) {
  const s = state(w)!;
  delete s.tree;
  runstate.saveRun(dirOf(w), s);
}
/** What a refused build must leave alone. */
const untouched = (w: World) => [git(w.clone, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"), read(join(dirOf(w), "patches.json"))];

test("an existing integration branch becomes the build directory without a rebuild, and rollback still reaches -prev", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  // An older debaser built in place and left the checkout on the integration branch.
  configureTree(w, ["mine"], { tree: "." });
  expect((await run(w, "build")).code).toBe(0);
  const old = git(w.clone, "rev-parse", "debaser");
  git(w.clone, "switch", "-q", "main");
  forgetTree(w);
  const result = await run(w, "build");
  expect(result.code).toBe(0);
  expect(result.err).toContain(`creating the build directory ${real(w.root)}/clone-debaser from debaser`);
  expect(listed(w).tree).toBe("../clone-debaser");
  expect(git(w.clone, "rev-parse", "debaser-prev")).toBe(old);
  expect(git(w.clone, "branch", "--show-current")).toBe("main");
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(git(w.clone, "rev-parse", "debaser")).toBe(old);
  expect(git(treeOf(w), "rev-parse", "HEAD")).toBe(old);
  expect(git(w.clone, "branch", "--show-current")).toBe("main");
});

test("a build refuses while the main checkout holds the integration branch, and changes nothing", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"], { tree: "." });
  expect((await run(w, "build")).code).toBe(0);
  forgetTree(w);
  const before = untouched(w);
  const refused = await run(w, "build");
  expect(refused.code).toBe(1);
  const main = real(w.clone);
  expect(refused.err).toContain(`the main checkout (${main}) has debaser checked out; switch it away first: git -C ${main} switch main`);
  expect(untouched(w)).toEqual(before);
  expect(existsSync(treeOf(w))).toBe(false);
});

test("a build refuses while another worktree holds the integration branch, naming it", async () => {
  const w = world(),
    agent = join(w.root, "agent-session");
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  git(treeOf(w), "switch", "-q", "--detach");
  git(w.clone, "worktree", "add", "-q", agent, "debaser");
  const before = untouched(w);
  const refused = await run(w, "build");
  expect(refused.code).toBe(1);
  expect(refused.err).toMatch(/debaser is checked out in another worktree \(\S*agent-session\); switch it away first/);
  expect(untouched(w)).toEqual(before);
});

/** A conflict stop as an older debaser left it: in place, with no build directory in the run state or the patch list. */
async function legacyStop(w: World) {
  conflicting(w);
  configureTree(w, ["left", "right"], { tree: "." });
  expect((await run(w, "build")).code).toBe(2);
  forgetRunTree(w);
  forgetTree(w);
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
}

test("a run stopped before the build directory continues where the integration branch is checked out", async () => {
  const w = world();
  await legacyStop(w);
  write(w.clone, { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(w.clone, "add", "base.txt");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(state(w)).toBeNull();
  expect(read(join(w.clone, "base.txt"))).toBe("one\nLEFT and RIGHT\nthree\n");
  expect(existsSync(treeOf(w))).toBe(false);
});

test("a run stopped before the build directory rolls back where the integration branch is checked out", async () => {
  const w = world();
  await legacyStop(w);
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(state(w)).toBeNull();
  expect(git(w.clone, "branch", "--show-current")).toBe("main");
  expect(gitTool.branchExists(w.clone, "debaser")).toBe(false);
});

test("a run stopped before the build directory continues and rolls back in the worktree holding the integration branch, started from another one", async () => {
  const w = world(),
    other = join(w.root, "other");
  await legacyStop(w);
  git(w.clone, "worktree", "add", "-q", "--detach", other);
  const elsewhere = checkoutState(other);
  write(w.clone, { "base.txt": "one\nLEFT and RIGHT\nthree\n" });
  git(w.clone, "add", "base.txt");
  const resumed = await runWith(w, { cwd: other }, "continue");
  expect(resumed.code).toBe(0);
  expect(git(w.clone, "log", "-1", "--format=%s", "debaser")).not.toBe(git(w.clone, "log", "-1", "--format=%s", "main"));
  expect(git(w.clone, "status", "--porcelain", "--untracked-files=no")).toBe("");
  expect(checkoutState(other)).toEqual(elsewhere);

  const v = world(),
    third = join(v.root, "third");
  await legacyStop(v);
  git(v.clone, "worktree", "add", "-q", "--detach", third);
  const untouchedThird = checkoutState(third);
  const back = await runWith(v, { cwd: third }, "rollback");
  expect(back.code).toBe(0);
  expect(git(v.clone, "branch", "--show-current")).toBe("main");
  expect(gitTool.branchExists(v.clone, "debaser")).toBe(false);
  expect(checkoutState(third)).toEqual(untouchedThird);
});

test("a run stopped before the build directory, with the integration branch checked out nowhere, says where to check it out", async () => {
  const w = world();
  await legacyStop(w);
  git(w.clone, "merge", "--abort");
  git(w.clone, "switch", "-q", "main");
  const refused = await run(w, "continue");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("no worktree has debaser checked out; check it out again where the run was started");
});

// US5

test("a build directory recorded as the checkout itself builds in place, and only from a clean checkout", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"], { tree: "." });
  expect((await run(w, "build")).code).toBe(0);
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
  expect(read(join(w.clone, "mine.txt"))).toBe("mine\n");
  expect(existsSync(treeOf(w))).toBe(false);
  write(w.clone, { "base.txt": "dirty\n" });
  const refused = await run(w, "build");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain(`the build directory ${real(w.clone)} has uncommitted changes in: base.txt; commit, stash or discard them first`);
});

// Edge cases

test("modified tracked files in the build directory refuse a build, listing them; untracked files never do", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  write(treeOf(w), { "scratch.txt": "untracked\n" });
  expect((await run(w, "build")).code).toBe(0);
  write(treeOf(w), { "mine.txt": "experiment\n" });
  const refused = await run(w, "build");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain(`the build directory ${real(treeOf(w))} has uncommitted changes in: mine.txt; commit, stash or discard them first`);
});

test("a build directory on another branch, or detached while the integration branch exists, is refused", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  // A second build, so rollback has a previous build to go back to.
  expect((await run(w, "build")).code).toBe(0);
  const patches = join(dirOf(w), "patches.json");
  git(treeOf(w), "switch", "-q", "-c", "other");
  const other = await run(w, "build");
  expect(other.code).toBe(1);
  expect(other.err).toContain(
    `the build directory ${real(treeOf(w))} has other checked out, not debaser; switch it back first, or set another path as "tree" in ${patches}`,
  );
  // rollback without a run refuses the same way (FR-007).
  expect((await run(w, "rollback")).err).toContain("has other checked out, not debaser");
  git(treeOf(w), "switch", "-q", "--detach", "debaser");
  const detached = await run(w, "build");
  expect(detached.code).toBe(1);
  expect(detached.err).toContain("has a detached HEAD checked out, not debaser");
});

test("a build directory deleted by hand is recreated at its recorded path, and the build says so", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  expect((await run(w, "build")).code).toBe(0);
  rmSync(treeOf(w), { recursive: true, force: true });
  const again = await run(w, "build");
  expect(again.code).toBe(0);
  expect(again.err).toContain(`creating the build directory ${real(w.root)}/clone-debaser from debaser (it was missing)`);
  expect(git(treeOf(w), "branch", "--show-current")).toBe("debaser");
});

test("a directory that is not a worktree of this repository is never used", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  // A plain directory at the default path, before anything is recorded.
  mkdirSync(treeOf(w));
  configureTree(w, ["mine"]);
  const refused = await run(w, "build");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain(`${real(w.root)}/clone-debaser is not a worktree of this repository; set another path as "tree" in ${join(dirOf(w), "patches.json")}`);
  expect(listed(w).tree).toBeUndefined();
  // A recorded path that is another repository.
  const elsewhere = join(w.root, "elsewhere");
  mkdirSync(elsewhere);
  git(elsewhere, "init", "-q");
  configureTree(w, ["mine"], { tree: "../elsewhere" });
  const foreign = await run(w, "build");
  expect(foreign.code).toBe(1);
  expect(foreign.err).toContain("elsewhere is not a worktree of this repository");
});

test("a build directory set by the user is used and kept as written", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"], { tree: "../elsewhere" });
  expect((await run(w, "build")).code).toBe(0);
  expect(read(join(w.root, "elsewhere", "mine.txt"))).toBe("mine\n");
  expect(listed(w).tree).toBe("../elsewhere");
  expect(existsSync(treeOf(w))).toBe(false);
});

test("started inside a linked worktree, the first build still creates the build directory beside the main checkout", async () => {
  const w = world(),
    linked = join(w.root, "nested", "linked");
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  git(w.clone, "worktree", "add", "-q", "--detach", linked, "main");
  expect((await runWith(w, { cwd: linked }, "build")).code).toBe(0);
  expect(git(treeOf(w), "branch", "--show-current")).toBe("debaser");
  expect(listed(w).tree).toBe("../clone-debaser");
});

test("with the data directory outside the repository, the build directory still sits beside the main checkout", async () => {
  const w = world(),
    data = fresh("data");
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureTree(w, ["mine"]);
  for (const file of ["patches.json", "recipe.toml"]) writeFileSync(join(data, file), read(join(dirOf(w), file)));
  rmSync(dirOf(w), { recursive: true, force: true });
  w.env.DEBASER_DIR = data;
  expect((await run(w, "build")).code).toBe(0);
  expect(git(treeOf(w), "branch", "--show-current")).toBe("debaser");
  expect(JSON.parse(read(join(data, "patches.json"))).tree).toBe("../clone-debaser");
});
