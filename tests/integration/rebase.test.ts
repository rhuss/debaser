import { expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as patchlist from "../../src/core/patchlist";
import * as runstate from "../../src/core/runstate";
import type { RebaseResult } from "../../src/core/runstate";
import * as gitTool from "../../src/git";
import { commonDirOf } from "../../src/core/paths";
import type { LiveEvent } from "../../src/live/events";
import { display } from "../../src/plugins/sources/parse";
import {
  backupOf,
  behindUpstream,
  branch,
  commit,
  configure,
  configureOwn,
  conflictingLine,
  eventWords,
  dirOf,
  fork,
  forkBranch,
  fresh,
  git,
  handoffs,
  head,
  latest,
  noGh,
  onFork,
  ownPullRequest,
  pullRequest,
  read,
  run,
  runWith,
  stamped,
  state,
  stubGh,
  stubHarness,
  takeTheirs,
  tip,
  upstreamMoves,
  withStep,
  write,
  world,
  type Extra,
} from "../support/world";

setDefaultTimeout(180_000);

test("rebuild rebases own branches behind upstream, conflicting or not, and merges the rebased tips", async () => {
  const w = world();
  const clean = branch(w, "clean", { "clean.txt": "clean\n" }),
    stale = branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["clean", "stale"], { harness: { command: stubHarness(takeTheirs).command } });
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  for (const name of ["clean", "stale"]) expect(behindUpstream(w, name)).toBe(false);
  expect([backupOf(w, "clean"), backupOf(w, "stale")]).toEqual([clean, stale] as (string | null)[]);
  expect(stamped(w).map(p => p.commit)).toEqual([tip(w, "clean")!, tip(w, "stale")!]);
  expect(result.out).toContain(`rebased stale: ${stale.slice(0, 7)} to ${tip(w, "stale")!.slice(0, 7)} (harness)`);
  expect(result.out).toContain("undo: git branch -f stale refs/debaser/rebase-backup/stale");
  expect(read(join(latest(w), "report.md"))).toContain(
    "undo: git branch -f stale refs/debaser/rebase-backup/stale",
  );
  expect(result.out).toContain(
    `git push --force-with-lease=refs/heads/clean: origin ${tip(w, "clean")}:refs/heads/clean`,
  );
  expect(read(join(latest(w), "report.md"))).toContain("## Rebased branches");
});

test("the rebase mode comes from the config, --rebase overrides it, and conflicting leaves clean branches", async () => {
  const w = world();
  const clean = branch(w, "clean", { "clean.txt": "clean\n" }),
    stale = branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["clean", "stale"], { rebase: "off", harness: { command: stubHarness(takeTheirs).command } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect([tip(w, "clean"), tip(w, "stale")]).toEqual([clean, stale]);
  const invalid = await run(w, "rebase", "--rebase=sometimes");
  expect(invalid.code).toBe(1);
  expect(invalid.err).toContain("--rebase must be one of all, conflicting, off");
  expect(state(w)).toBeNull();
  expect((await run(w, "rebuild", "--rebase=conflicting")).code).toBe(0);
  expect(tip(w, "clean")).toBe(clean);
  expect(behindUpstream(w, "stale")).toBe(false);
  expect(stamped(w).map(p => p.commit)).toEqual([clean, tip(w, "stale")!]);
});

test("other people's branches and PRs are never rebased and keep their rebase handoffs", async () => {
  const w = world();
  forkBranch(w, "other/widget", "topic", conflictingLine("TOPIC"));
  pullRequest(w, "acme/widget", 7, conflictingLine("PR"));
  stubGh(w, { "acme/widget#7": { state: "OPEN", title: "theirs", head: "other/widget:feature" } });
  // A branch of the same name on the user's fork, behind upstream: ownership must not come from the name.
  const mine = branch(w, "feature", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "feature");
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["other/widget:topic", "#7"], { harness: { command: stubHarness(takeTheirs).command } });
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(result.out).not.toContain("rebased acme/widget#7");
  expect(git(w.clone, "for-each-ref", "refs/debaser/rebase-backup")).toBe("");
  expect([tip(w, "feature"), onFork(w, "feature")]).toEqual([mine, mine]);
  const files = handoffs(w);
  expect(files).toHaveLength(2);
  for (const file of files) expect(read(join(latest(w), "handoffs", file))).toContain("- Kind: rebase\n");
});

test("an own PR's head branch is rebased into a new local branch and pushed to the fork; without gh it is not", async () => {
  const w = world();
  const old = ownPullRequest(w, 5, "feature", { "feature.txt": "f\n" });
  stubGh(w, { "acme/widget#5": { state: "OPEN", title: "feature", head: "me/widget:feature" } });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["#5"]);
  const result = await run(w, "rebuild", "--push");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "feature")).toBe(false);
  expect(onFork(w, "feature")).toBe(tip(w, "feature")!);
  expect(backupOf(w, "feature")).toBeNull();
  expect(result.out).toContain("pushed feature to origin");
  // What was pushed is what origin has: status doesn't take the old tip for a divergence.
  const status = await run(w, "status");
  expect(status.out).toMatch(/acme\/widget#5 +✓ clean +✓ up to date/);

  const u = world(),
    unchanged = ownPullRequest(u, 5, "feature", { "feature.txt": "f\n" });
  noGh(u);
  upstreamMoves(u, { "up.txt": "up\n" });
  configureOwn(u, ["#5"]);
  const without = await run(u, "rebase");
  expect(without.code).toBe(0);
  expect(without.out).toContain("gh could not tell whose branch acme/widget#5 is from (is gh installed and signed in?)");
  expect(git(u.clone, "branch", "--list", "feature")).toBe("");
  expect(onFork(u, "feature")).toBe(unchanged);
  expect(onFork(w, "feature")).not.toBe(old);
});
/** A test that fails while mine.txt still says "old" and upstream's up.txt is there. */
const clashesWithUpstream = withStep("test", { run: ["sh", "-c", "echo 'both files'; ! { test -f up.txt && grep -q old mine.txt; }"] });
test("a rebased branch whose tests fail alone keeps its old tip and gets a rebase-checks handoff", async () => {
  const w = world();
  const old = branch(w, "mine", { "mine.txt": "old\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"], { steps: clashesWithUpstream });
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect(tip(w, "mine")).toBe(old);
  expect(backupOf(w, "mine")).toBeNull();
  expect(result.out).toContain("mine: not rebased: test fails on the rebased branch");
  expect(result.err).toContain("test failed on mine; running what failed once more in case it is flaky");
  expect(handoffs(w)).toEqual(["mine.md"]);
  const handoff = read(join(latest(w), "handoffs", "mine.md"));
  expect(handoff).toContain("- Kind: rebase-checks\n");
  expect(handoff).toContain("(test) fails on mine alone");
  expect(handoff).toContain("both files");
});
test("the harness adapts a rebased branch whose checks fail, as a fix commit to review before pushing", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "old\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  const h = stubHarness(`cp "$1" "$(dirname "$0")/prompt-file"; echo new > mine.txt`);
  configureOwn(w, ["mine"], { steps: clashesWithUpstream, harness: { command: h.command } });
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(1);
  const prompt = read(join(h.bin, "prompt-file"));
  expect(prompt).toContain("- Branch: mine");
  expect(prompt).toContain("- Check: test");
  expect(prompt).toContain("both files");
  // The branch moved onto upstream, with the fix on top.
  expect(behindUpstream(w, "mine")).toBe(false);
  expect(git(w.clone, "log", "-1", "--format=%s%n%(trailers:key=Fixed-By,valueonly)", "mine")).toMatch(
    /^fix: pass test on upstream [0-9a-f]{7}\nharness/,
  );
  expect(git(w.clone, "show", "mine:mine.txt")).toBe("new");
  const fix = tip(w, "mine")!.slice(0, 7);
  expect(result.out).toContain(`the harness fixed its checks in ${fix}, review before pushing`);
  expect(read(join(latest(w), "report.md"))).toContain("mine test rebased-branch fix try 1: accepted");
  // The fix is shown before the push question.
  const asked: string[] = [];
  const v = world();
  branch(v, "mine", { "mine.txt": "old\n" });
  upstreamMoves(v, { "up.txt": "up\n" });
  configureOwn(v, ["mine"], { steps: clashesWithUpstream, harness: { command: stubHarness("echo new > mine.txt").command } });
  const pushed = await runWith(v, { ask: q => (asked.push(q), "n") }, "rebase");
  expect(pushed.code).toBe(0);
  const shown = pushed.err.indexOf(`review mine before pushing: the harness fixed its checks in ${tip(v, "mine")!.slice(0, 7)}`);
  expect(shown).toBeGreaterThanOrEqual(0);
  expect(asked).toHaveLength(1);
});
test("a harness that can't fix a rebased branch's checks leaves it at its old tip after its tries", async () => {
  const w = world();
  const old = branch(w, "mine", { "mine.txt": "old\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  const h = stubHarness("true");
  configureOwn(w, ["mine"], { steps: clashesWithUpstream, harness: { command: h.command, attempts: 2 } });
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(tip(w, "mine")).toBe(old);
  expect(result.out).toContain(
    "mine: not rebased: test fails on the rebased branch; the harness could not fix it in 2 tries",
  );
});
test("a rebased branch whose check passes only when run again moves, with a flaky warning", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  const tried = join(fresh("flaky"), "tried");
  configureOwn(w, ["mine"], {
    steps: withStep("test", { run: ["sh", "-c", `test -f "${tried}" || { touch "${tried}"; false; }`] }),
  });
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "mine")).toBe(false);
  expect(result.out).toContain("test failed once and passed when run again, it may be flaky");
  expect(read(join(latest(w), "report.md"))).toContain("mine-test-flaky.log");
});

test("inside rebuild an unresolved rebase conflict keeps the old tip, and the run goes on to merge it", async () => {
  const w = world();
  const old = branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["stale"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(2);
  expect(result.out).toContain("merge conflict in stale");
  expect(tip(w, "stale")).toBe(old);
  expect(state(w)?.rebased?.find(r => r.patch === "stale")?.outcome).toBe("failed");
  expect(state(w)?.plan.find(p => p.display === "stale")?.commit).toBe(old);
  expect(read(join(latest(w), "handoffs", "stale.md"))).toContain("- Kind: rebase\n");
  expect(readdirSync(join(dirOf(w), "work")).filter(name => name.startsWith("rebase-"))).toEqual([]);

  // With a harness that keeps failing, the rebuild still goes on with the old tip.
  const u = world();
  const kept = branch(u, "stale", conflictingLine("STALE"));
  upstreamMoves(u, conflictingLine("UPSTREAM"));
  configureOwn(u, ["stale"], { harness: { command: stubHarness("echo junk > junk.txt").command, attempts: 1 } });
  const done = await run(u, "rebuild");
  expect(done.code).toBe(5);
  expect(done.out).toContain("the harness could not resolve the conflict in stale");
  expect(tip(u, "stale")).toBe(kept);
  expect(state(u)?.rebased?.find(r => r.patch === "stale")?.outcome).toBe("failed");
});

test("the rebase command stops at a conflict it can't resolve; continue, --skip-branch and rollback end it", async () => {
  const w = world();
  const first = branch(w, "first", conflictingLine("FIRST"));
  const second = branch(w, "second", conflictingLine("SECOND"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["first", "second"]);
  const stopped = await run(w, "rebase");
  expect(stopped.code).toBe(2);
  expect(stopped.out).toMatch(/rebase conflict in first at [0-9a-f]{7} first: change/);
  expect(stopped.out).toContain("files: base.txt");
  const tree = /worktree: (\S+)/.exec(stopped.out)![1];
  const refused = await run(w, "rebuild");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("a run is stopped or in progress");
  write(tree, conflictingLine("UPSTREAM FIRST"));
  git(tree, "add", "base.txt");
  // An edit after `git add` is not a resolution to skip past: the run stops again, the commit kept.
  write(tree, conflictingLine("UPSTREAM FIRST, EDITED"));
  const unstaged = await run(w, "continue");
  expect(unstaged.code).toBe(2);
  expect(unstaged.out).toContain("problem: ");
  expect(tip(w, "first")).toBe(first);
  git(tree, "add", "base.txt");
  const next = await run(w, "continue");
  expect(next.code).toBe(2);
  expect(next.out).not.toContain("git push");
  expect(behindUpstream(w, "first")).toBe(false);
  expect(git(w.clone, "show", "first:base.txt")).toBe("one\nUPSTREAM FIRST, EDITED\nthree");
  const skipped = await run(w, "rebase", "--skip-branch");
  expect(skipped.code).toBe(0);
  expect(skipped.out).toContain("second: skipped");
  expect(tip(w, "second")).toBe(second);
  expect(state(w)).toBeNull();

  expect((await run(w, "rebase")).code).toBe(2);
  const undone = await run(w, "rollback");
  expect(undone.code).toBe(0);
  expect(undone.out).toContain("first: rebased earlier, push pending");
  expect(state(w)).toBeNull();
  expect(tip(w, "second")).toBe(second);
  expect(readdirSync(join(dirOf(w), "work")).filter(name => name.startsWith("rebase-"))).toEqual([]);

  // A harness that can't resolve it stops with 5.
  configureOwn(w, ["second"], { harness: { command: stubHarness("true").command, attempts: 1 } });
  const exhausted = await run(w, "rebase");
  expect(exhausted.code).toBe(5);
  expect(exhausted.out).toContain("the harness could not resolve the rebase conflict in second");
  expect((await run(w, "rollback")).code).toBe(0);
});

test("rebased branches are pushed with a lease after a yes or with --push, and a moved remote copy is kept", async () => {
  const setup = () => {
    const w = world();
    const old = branch(w, "mine", { "mine.txt": "mine\n" });
    git(w.clone, "push", "-q", "origin", "mine");
    upstreamMoves(w, { "up.txt": "up\n" });
    configureOwn(w, ["mine"]);
    return { w, old };
  };
  const asked: string[] = [];
  const yes = setup(),
    accepted = await runWith(yes.w, { ask: q => (asked.push(q), "y") }, "rebase");
  expect(accepted.code).toBe(0);
  expect(asked).toEqual(["Force-push 1 rebased branch to origin (mine)? [y/N] "]);
  expect(onFork(yes.w, "mine")).toBe(tip(yes.w, "mine")!);
  expect(backupOf(yes.w, "mine")).toBeNull();

  const forced = setup();
  expect((await run(forced.w, "rebase", "--push")).code).toBe(0);
  expect(onFork(forced.w, "mine")).toBe(tip(forced.w, "mine")!);

  const declined = setup(),
    no = await runWith(declined.w, { ask: () => "n" }, "rebase");
  expect(no.code).toBe(0);
  expect(onFork(declined.w, "mine")).toBe(declined.old);
  expect(no.out).toContain(`git push --force-with-lease=refs/heads/mine:${declined.old} origin`);

  const raced = setup(),
    elsewhere = git(raced.w.seed, "rev-parse", "main");
  const refused = await runWith(
    raced.w,
    { ask: () => (git(raced.w.seed, "push", "-q", "-f", fork(raced.w), "main:refs/heads/mine"), "y") },
    "rebase",
  );
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("push of mine refused");
  expect(refused.out).toContain(`retry: git push --force-with-lease=refs/heads/mine:${raced.old} origin`);
  expect(existsSync(join(latest(raced.w), "rebase", "mine-push.log"))).toBe(true);
  expect(onFork(raced.w, "mine")).toBe(elsewhere);
  expect(backupOf(raced.w, "mine")).toBe(raced.old);
  // Four worlds, each rebased and checked.
}, 180_000);

test("own branches checked out, diverged or already upstream are left alone, and so is everything without a fork", async () => {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" }),
    split = branch(w, "split", { "split.txt": "split\n" }),
    landed = branch(w, "landed", { "landed.txt": "landed\n" });
  git(w.clone, "worktree", "add", "-q", join(fresh("busy"), "tree"), "busy");
  git(w.clone, "push", "-q", "origin", "split");
  git(w.seed, "fetch", "-q", fork(w), "split");
  git(w.seed, "checkout", "-q", "--detach", "FETCH_HEAD");
  commit(w.seed, { "remote.txt": "r\n" }, "remote change");
  git(w.seed, "push", "-q", fork(w), "HEAD:refs/heads/split");
  git(w.seed, "checkout", "-q", "main");
  git(w.clone, "checkout", "-q", "split");
  const local = commit(w.clone, { "local.txt": "l\n" }, "local change");
  git(w.clone, "checkout", "-q", "main");
  upstreamMoves(w, { "landed.txt": "landed\n" });
  configureOwn(w, ["busy", "split", "landed"]);
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect([tip(w, "busy"), tip(w, "split"), tip(w, "landed")]).toEqual([busy, local, landed]);
  expect(result.out).toContain("busy: skipped: checked out in ");
  expect(result.out).toContain("split: skipped: the local branch and origin/split have diverged");
  expect(result.out).toContain("landed: skipped: no commits left on top of upstream; remove the patch");
  expect(split).not.toBe(local);

  const u = world();
  const mine = branch(u, "mine", { "mine.txt": "mine\n" });
  git(u.clone, "remote", "set-url", "origin", u.upstream);
  upstreamMoves(u, { "up.txt": "up\n" });
  configureOwn(u, ["mine"]);
  const off = await run(u, "rebase");
  expect(off.code).toBe(0);
  expect(off.out).toContain("rebasing is off: origin is upstream itself, so there is no fork to push to");
  expect(tip(u, "mine")).toBe(mine);
});

test("rebase --in-worktree rebases a checked-out branch in its own worktree, or skips a dirty one", async () => {
  const w = world();
  const busy = branch(w, "busy", conflictingLine("BUSY")),
    dirty = branch(w, "dirty", { "dirty.txt": "dirty\n" });
  const busyTree = join(fresh("busy"), "tree"),
    dirtyTree = join(fresh("dirty"), "tree");
  git(w.clone, "worktree", "add", "-q", busyTree, "busy");
  git(w.clone, "worktree", "add", "-q", dirtyTree, "dirty");
  write(dirtyTree, { "dirty.txt": "changed\n" });
  git(dirtyTree, "add", "--", "dirty.txt");
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["busy", "dirty"], { harness: { command: stubHarness(takeTheirs).command } });
  const result = await run(w, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "busy")).toBe(false);
  expect(backupOf(w, "busy")).toBe(busy);
  // The worktree moved with its branch: in sync, clean, and the harness resolved the conflict there.
  expect(git(busyTree, "rev-parse", "HEAD")).toBe(tip(w, "busy")!);
  expect(git(busyTree, "status", "--porcelain")).toBe("");
  expect(result.out).toMatch(/rebased busy: [0-9a-f]{7} to [0-9a-f]{7} \(harness\)/);
  // A worktree with uncommitted tracked changes is left completely alone.
  expect(behindUpstream(w, "dirty")).toBe(true);
  expect(tip(w, "dirty")).toBe(dirty);
  expect(result.out).toContain("dirty: skipped: uncommitted changes in ");
});

test("a rejected in-worktree resolution keeps the worktree's untracked files", async () => {
  const w = world();
  branch(w, "busy", conflictingLine("BUSY"));
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  const calls = join(fresh("calls"), "n");
  // Call 1 leaves the conflict unresolved after writing an untracked file; call 2 resolves it.
  const h = stubHarness(
    `n=$(cat "${calls}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${calls}"\n[ "$n" = 1 ] && echo precious > keep.txt\n[ "$n" = 2 ] && ${takeTheirs}\nexit 0`,
  );
  configureOwn(w, ["busy"], { harness: { command: h.command } });
  const result = await run(w, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(behindUpstream(w, "busy")).toBe(false);
  expect(read(join(tree, "keep.txt"))).toBe("precious\n");
  expect(result.out).toMatch(/rebased busy: [0-9a-f]{7} to [0-9a-f]{7} \(harness\)/);
});

test("an in-worktree rebase whose checks fail puts the branch back where it was", async () => {
  const w = world();
  const busy = branch(w, "busy", { "bad.txt": "BROKEN\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["busy"]);
  const result = await run(w, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(result.out).toContain("busy: not rebased: typecheck fails on the rebased branch");
  expect(tip(w, "busy")).toBe(busy);
  expect(git(tree, "rev-parse", "HEAD")).toBe(busy);
  expect(git(tree, "status", "--porcelain")).toBe("");
  // The backup was kept from the rebase's start; after the restore it names
  // the tip the branch is back at, harmless until the branch is pushed.
  expect(backupOf(w, "busy")).toBe(busy);
});

test("an in-worktree rebase records its backup before the rebase moves the branch", async () => {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  const seen = join(fresh("backup"), "at-check.txt");
  // The test step runs in the worktree after the rebase moved the branch; the
  // backup must already be there, so an interruption during the checks undoes.
  configureOwn(w, ["busy"], {
    steps: withStep("test", { run: [
        "sh",
        "-c",
        `git rev-parse refs/debaser/rebase-backup/busy > "${seen}" 2>/dev/null || echo none > "${seen}"`,
      ] }),
  });
  const result = await run(w, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(result.out).toMatch(/rebased busy: [0-9a-f]{7} to [0-9a-f]{7}/);
  expect(read(seen)).toBe(`${busy}\n`);
});

test("an in-worktree rebase whose checks approve an edit made while they ran stays unchecked", async () => {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  // The test step plays the user editing the worktree while the checks run:
  // a passing check on the edited files must not record `to` as checked.
  configureOwn(w, ["busy"], {
    steps: withStep("test", { run: ["sh", "-c", "echo edited >> busy.txt"] }),
  });
  const result = await run(w, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "busy")).toBe(false);
  expect(result.out).toContain("busy: skipped: ");
  expect(result.out).toContain("changed during the checks; busy keeps its rebased tip, unchecked");
  // The worktree keeps its edit and the rebased tip; nothing is pushed.
  expect(read(join(tree, "busy.txt"))).toBe("busy\nedited\n");
  expect(git(tree, "rev-parse", "HEAD")).toBe(tip(w, "busy")!);
  expect(backupOf(w, "busy")).toBe(busy);
  expect(onFork(w, "busy")).toBe("");
});

test("an in-worktree rebase whose checks approve a commit made while they ran stays unchecked", async () => {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  const committed = join(fresh("commit"), "done");
  configureOwn(w, ["busy"], {
    steps: withStep("test", { run: [
        "sh",
        "-c",
        `if [ ! -f "${committed}" ]; then echo x > extra.txt; git add extra.txt; git commit -q -m meanwhile; touch "${committed}"; fi`,
      ] }),
  });
  const result = await run(w, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(result.out).toContain("busy: skipped: ");
  expect(result.out).toContain("changed during the checks; busy keeps its rebased tip, unchecked");
  // The branch moved with the worktree's commit, which is kept but unchecked.
  expect(git(tree, "rev-parse", "HEAD")).toBe(tip(w, "busy")!);
  expect(git(tree, "status", "--porcelain")).toBe("");
  expect(git(w.clone, "show", "busy:extra.txt")).toBe("x");
  expect(onFork(w, "busy")).toBe("");
});

test("rebase --in-worktree leaves checked-out branches alone that are current or that the mode skips", async () => {
  const w = world();
  const clean = branch(w, "clean", { "clean.txt": "clean\n" });
  git(w.clone, "worktree", "add", "-q", join(fresh("clean"), "tree"), "clean");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["clean"]);
  const skipped = await run(w, "rebase", "--in-worktree", "--rebase=conflicting");
  expect(skipped.code).toBe(0);
  expect(tip(w, "clean")).toBe(clean);
  expect(backupOf(w, "clean")).toBeNull();
  // Rebased once, it is current: a second run doesn't rewrite it again.
  expect((await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree")).code).toBe(0);
  const rebased = tip(w, "clean")!;
  expect(rebased).not.toBe(clean);
  const again = await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree");
  expect(again.code).toBe(0);
  expect(tip(w, "clean")).toBe(rebased);
  expect(again.out).not.toContain("rebased clean");
});

test("rebase --in-worktree rebases a checked-out branch with a pending push onto the newer upstream", async () => {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" });
  git(w.clone, "push", "-q", "origin", "busy");
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["busy"]);
  // Rebased, push declined: the push is pending at the first upstream.
  expect((await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree")).code).toBe(0);
  const first = tip(w, "busy")!;
  expect(first).not.toBe(busy);
  upstreamMoves(w, { "later.txt": "later\n" });
  const result = await run(w, "rebase", "--in-worktree", "--push");
  expect(result.code).toBe(0);
  expect(result.out).toMatch(/rebased busy: [0-9a-f]{7} to [0-9a-f]{7}/);
  expect(result.out).not.toContain("busy: rebased earlier, push pending");
  expect(behindUpstream(w, "busy")).toBe(false);
  expect(git(tree, "rev-parse", "HEAD")).toBe(tip(w, "busy")!);
  expect(onFork(w, "busy")).toBe(tip(w, "busy")!);
});

test("a rejected in-worktree resolution after an earlier commit keeps the branch attached and moves it", async () => {
  const w = world();
  branch(w, "busy", { "first.txt": "first\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  commit(tree, conflictingLine("BUSY"), "conflicting change");
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  const calls = join(fresh("calls"), "n");
  // Call 1 leaves the conflict unresolved, so the retry replays from the conflicting commit; call 2 resolves it.
  const h = stubHarness(
    `n=$(cat "${calls}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${calls}"\n[ "$n" = 2 ] && ${takeTheirs}\nexit 0`,
  );
  configureOwn(w, ["busy"], { harness: { command: h.command } });
  const result = await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(git(tree, "symbolic-ref", "HEAD")).toBe("refs/heads/busy");
  expect(behindUpstream(w, "busy")).toBe(false);
  expect(git(tree, "rev-parse", "HEAD")).toBe(tip(w, "busy")!);
  expect(result.out).toContain(`git push --force-with-lease=refs/heads/busy: origin ${tip(w, "busy")}:refs/heads/busy`);
});

test("an in-worktree rebase skips a worktree that switched branches since the run chose it", async () => {
  const w = world();
  branch(w, "first", { "first.txt": "first\n" });
  const second = branch(w, "second", { "second.txt": "second\n" }),
    other = branch(w, "other", { "other.txt": "other\n" });
  const firstTree = join(fresh("first"), "tree"),
    secondTree = join(fresh("second"), "tree");
  git(w.clone, "worktree", "add", "-q", firstTree, "first");
  git(w.clone, "worktree", "add", "-q", secondTree, "second");
  upstreamMoves(w, { "up.txt": "up\n" });
  // While first is checked, the user switches second's worktree to another clean branch.
  configureOwn(w, ["first", "second"], {
    steps: withStep("test", { run: ["sh", "-c", `git -C "${secondTree}" checkout -q other 2>/dev/null || true`] }),
  });
  const result = await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "first")).toBe(false);
  expect([tip(w, "second"), tip(w, "other")]).toEqual([second, other]);
  expect(git(secondTree, "symbolic-ref", "--short", "HEAD")).toBe("other");
  expect(result.out).toMatch(
    new RegExp(`second: skipped: \\S*/second-\\d+/tree no longer has second at ${second.slice(0, 7)} checked out`),
  );
});

/** A `rebase --in-worktree` run of `busy` left as an interruption during its
 * checks would leave it: the test step saves the run state and the tip under
 * check, which are put back after the run. */
async function interruptedInWorktree() {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  const saved = fresh("run"),
    checking = "refs/debaser/rebase-checking/busy";
  configureOwn(w, ["busy"], {
    steps: withStep("test", { run: [
        "sh",
        "-c",
        `cp "${join(dirOf(w), "run.json")}" "${saved}/run.json" && git rev-parse ${checking} > "${saved}/tip"`,
      ] }),
  });
  expect((await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree")).code).toBe(0);
  const moved = tip(w, "busy")!;
  expect(moved).not.toBe(busy);
  expect(read(join(saved, "tip"))).toBe(`${moved}\n`);
  writeFileSync(join(dirOf(w), "run.json"), read(join(saved, "run.json")));
  git(w.clone, "update-ref", checking, moved);
  return { w, busy, tree, moved };
}

test("rollback of a rebase run interrupted during an in-worktree branch's checks puts the branch back", async () => {
  const { w, busy, tree, moved } = await interruptedInWorktree();
  const result = await run(w, "rollback");
  expect(result.code).toBe(0);
  expect(result.out).toMatch(
    new RegExp(
      `put busy back at ${busy.slice(0, 7)} in \\S*/busy-\\d+/tree \\(it was at ${moved.slice(0, 7)}, unchecked\\)`,
    ),
  );
  expect(tip(w, "busy")).toBe(busy);
  expect(git(tree, "rev-parse", "HEAD")).toBe(busy);
  expect(state(w)).toBeNull();
  expect(tip(w, "refs/debaser/rebase-checking/busy")).toBeNull();
});

test("rollback after an interrupted in-worktree rebase keeps commits made on the branch since", async () => {
  const { w, tree } = await interruptedInWorktree();
  const mine = commit(tree, { "later.txt": "mine\n" }, "my later commit");
  const result = await run(w, "rollback");
  expect(result.code).toBe(0);
  expect(result.out).toContain(
    "it moved since the interrupted rebase; its tip before the rebase is refs/debaser/rebase-backup/busy",
  );
  expect(tip(w, "busy")).toBe(mine);
  expect(git(tree, "rev-parse", "HEAD")).toBe(mine);
});

test("an in-worktree check that fails keeps a commit made in the worktree during the checks", async () => {
  const w = world();
  branch(w, "busy", { "busy.txt": "busy\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  // The test step stands in for the user committing in the worktree, then fails.
  configureOwn(w, ["busy"], {
    steps: withStep("test", { run: [
        "sh",
        "-c",
        "echo mine > later.txt && git add later.txt && git -c user.name=t -c user.email=t@t commit -qm later && false",
      ] }),
  });
  const result = await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  expect(result.out).toContain("busy: not rebased: test fails on the rebased branch");
  expect(git(tree, "log", "-1", "--format=%s", "busy")).toBe("later");
  expect(git(tree, "rev-parse", "HEAD")).toBe(tip(w, "busy")!);
});

test("an in-worktree check that fails keeps uncommitted edits made during the checks", async () => {
  const w = world();
  const busy = branch(w, "busy", { "busy.txt": "busy\n" });
  const tree = join(fresh("busy"), "tree");
  git(w.clone, "worktree", "add", "-q", tree, "busy");
  upstreamMoves(w, { "up.txt": "up\n" });
  // The test step stands in for the user editing a tracked file in the worktree, then fails.
  configureOwn(w, ["busy"], { steps: withStep("test", { run: ["sh", "-c", "echo edited >> busy.txt && false"] }) });
  const result = await runWith(w, { ask: () => "n" }, "rebase", "--in-worktree");
  expect(result.code).toBe(0);
  const rebased = tip(w, "busy")!;
  expect(rebased).not.toBe(busy);
  expect(read(join(tree, "busy.txt"))).toBe("busy\nedited\nedited\n");
  // The worktree changed under the checks: its edits stay and the harness isn't asked.
  expect(result.out).toContain("busy: not rebased: test fails on the rebased branch; ");
  expect(result.out).toContain(" changed during the checks; its edits are kept and the harness was not asked; ");
  expect(result.out).toContain(`busy stays at ${rebased.slice(0, 7)} in `);
  expect(result.out).toContain(
    "which changed during the checks; its tip before the rebase is refs/debaser/rebase-backup/busy",
  );
});

test("a branch named by two patches is rebased once and both merge its new tip", async () => {
  const w = world();
  ownPullRequest(w, 5, "feature", { "feature.txt": "f\n" });
  git(w.clone, "fetch", "-q", "origin");
  git(w.clone, "branch", "-q", "feature", "origin/feature");
  stubGh(w, { "acme/widget#5": { state: "OPEN", title: "feature", head: "me/widget:feature" } });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["feature", "#5"]);
  const result = await runWith(w, { ask: () => "n" }, "rebuild");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "feature")).toBe(false);
  expect(result.out).toContain("the same branch as feature, handled with it");
  const plan = patchlist.load(dirOf(w))!.patches.map(p => display(p.source));
  expect(plan).toEqual(["feature", "acme/widget#5"]);
  for (const p of stamped(w)) expect(p.commit).toBe(tip(w, "feature")!);
});

test("a rejected harness resolution is retried from that commit, keeping git's choice of commits", async () => {
  const w = world();
  // The branch: X, A (conflicts later), a merge of upstream's U1, B.
  git(w.clone, "checkout", "-q", "-b", "two", "upstream/main");
  commit(w.clone, { "x.txt": "X\n" }, "X");
  commit(w.clone, conflictingLine("A"), "A");
  upstreamMoves(w, { "u1.txt": "u1\n" });
  git(w.clone, "fetch", "-q", "upstream");
  git(w.clone, "merge", "-q", "--no-ff", "--no-edit", "upstream/main");
  commit(w.clone, { "b.txt": "B\n" }, "B");
  git(w.clone, "checkout", "-q", "main");
  upstreamMoves(w, { ...conflictingLine("UPSTREAM"), "u1.txt": "u2\n" });
  // Settings that would change the replay or move the branch early must not apply.
  for (const [key, value] of [
    ["rebase.autoSquash", "true"],
    ["rebase.abbreviateCommands", "true"],
    ["rebase.missingCommitsCheck", "error"],
    ["rebase.updateRefs", "true"],
  ])
    git(w.clone, "config", key, value);
  const old = tip(w, "two");
  const calls = join(fresh("calls"), "n");
  // Call 1 (at A) also writes an unrelated file and is rejected; call 2 resolves A.
  const h = stubHarness(
    `n=$(cat "${calls}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${calls}"\n[ "$n" = 1 ] && echo x > extra.txt\n${takeTheirs}`,
  );
  configureOwn(w, ["two"], { harness: { command: h.command } });
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect(h.calls()).toBe(2);
  expect(result.out).toMatch(/rebased two: [0-9a-f]{7} to [0-9a-f]{7} \(harness\)/);
  expect(backupOf(w, "two")).toBe(old);
  expect(git(w.clone, "log", "--format=%s", "upstream/main..two").split("\n")).toEqual(["B", "A", "X"]);
  expect(git(w.clone, "ls-tree", "--name-only", "two")).not.toContain("extra.txt");
  expect([git(w.clone, "show", "two:base.txt"), git(w.clone, "show", "two:u1.txt")]).toEqual(["one\nA\nthree", "u2"]);
});

test("a rebase conflict resolved once replays through rerere the next time", async () => {
  const w = world();
  const old = branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["stale"]);
  const stopped = await run(w, "rebase");
  const tree = /worktree: (\S+)/.exec(stopped.out)![1];
  write(tree, conflictingLine("UPSTREAM STALE"));
  git(tree, "add", "base.txt");
  expect((await run(w, "continue")).code).toBe(0);
  git(w.clone, "branch", "-f", "stale", old);
  gitTool.deleteRef(w.clone, "refs/debaser/rebase-backup/stale");
  const again = await run(w, "rebase");
  expect(again.code).toBe(0);
  expect(again.out).toContain("(rerere)");
  expect(git(w.clone, "show", "stale:base.txt")).toBe("one\nUPSTREAM STALE\nthree");
});

test("a branch moved or checked out while it is rebased stays where it is", async () => {
  const moved = world();
  branch(moved, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(moved, { "up.txt": "up\n" });
  const elsewhere = git(moved.clone, "rev-parse", "main");
  configureOwn(moved, ["mine"], {
    steps: withStep("test", { run: ["sh", "-c", `git update-ref refs/heads/mine ${elsewhere}`] }),
  });
  const result = await run(moved, "rebase");
  expect(result.out).toContain("mine: skipped: the branch moved while it was rebased");
  expect(tip(moved, "mine")).toBe(elsewhere);
  expect(backupOf(moved, "mine")).toBeNull();

  const busy = world();
  const old = branch(busy, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(busy, { "up.txt": "up\n" });
  const other = join(fresh("busy"), "tree");
  configureOwn(busy, ["mine"], {
    steps: withStep("test", { run: ["sh", "-c", `git worktree add -q "${other}" mine`] }),
  });
  const checked = await run(busy, "rebase");
  expect(checked.out).toContain("mine: skipped: checked out in ");
  expect(tip(busy, "mine")).toBe(old);
  expect(backupOf(busy, "mine")).toBeNull();
});

test("a rebased branch not pushed yet is offered again and keeps its backup until it is rebased again from its new tip", async () => {
  const w = world();
  const old = branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  const first = await runWith(w, { ask: () => "n" }, "rebase");
  expect(first.code).toBe(0);
  const rebased = tip(w, "mine")!;
  expect(backupOf(w, "mine")).toBe(old);
  // Nothing new upstream: the pending push is offered again, not reported as diverged.
  const second = await runWith(w, { ask: () => "n" }, "rebase");
  expect(second.out).toContain("mine: rebased earlier, push pending");
  expect(second.out).not.toContain("diverged");
  expect(second.out).toContain(`git push --force-with-lease=refs/heads/mine:${old} origin ${rebased}:refs/heads/mine`);
  // A new commit on the rebased branch, then upstream moves again: rebased from
  // the new tip, which becomes the backup; the commit stays.
  git(w.clone, "checkout", "-q", "mine");
  const added = commit(w.clone, { "more.txt": "more\n" }, "more");
  git(w.clone, "checkout", "-q", "main");
  upstreamMoves(w, { "up2.txt": "up\n" });
  const third = await runWith(w, { ask: () => "n" }, "rebase");
  expect(third.out).toContain("rebased mine:");
  expect(backupOf(w, "mine")).toBe(added);
  expect(git(w.clone, "show", "mine:more.txt")).toBe("more");
  const pushed = await run(w, "rebase", "--push");
  expect(pushed.code).toBe(0);
  expect(pushed.out).toContain("pushed mine to origin");
  expect(behindUpstream(w, "mine")).toBe(false);
  expect(onFork(w, "mine")).toBe(tip(w, "mine")!);
  expect(backupOf(w, "mine")).toBeNull();
  expect(gitTool.isAncestor(w.clone, rebased, "mine")).toBe(false);
});

test("a rebuild merges an own PR's rebased head that is not pushed yet, not the old PR head", async () => {
  const w = world();
  const old = ownPullRequest(w, 5, "feature", { "feature.txt": "f\n" });
  stubGh(w, { "acme/widget#5": { state: "OPEN", title: "feature", head: "me/widget:feature" } });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["#5"]);
  expect((await runWith(w, { ask: () => "n" }, "rebase")).code).toBe(0);
  const rebased = tip(w, "feature")!;
  expect(rebased).not.toBe(old);
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(stamped(w).map(p => p.commit)).toEqual([rebased]);
});

test("a git rebase that fails before stopping is reported as failed, not as rebased", async () => {
  const w = world();
  const old = branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  const hooks = join(commonDirOf(w.clone), "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-rebase"), "#!/bin/sh\necho refusing >&2\nexit 1\n");
  chmodSync(join(hooks, "pre-rebase"), 0o755);
  configureOwn(w, ["mine"]);
  const result = await run(w, "rebase");
  expect(result.out).toContain("mine: not rebased: git rebase failed");
  expect(tip(w, "mine")).toBe(old);
  expect(backupOf(w, "mine")).toBeNull();
});

test("tips, leases and pushes use the URL origin pushes to", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  git(w.clone, "remote", "set-url", "origin", w.upstream);
  git(w.clone, "remote", "set-url", "--push", "origin", fork(w));
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  const result = await run(w, "rebase", "--push");
  expect(result.code).toBe(0);
  expect(result.out).toContain("pushed mine to origin");
  expect(onFork(w, "mine")).toBe(tip(w, "mine")!);
});

test("without an origin nothing is rebased, and worktrees an interrupted run left are removed", async () => {
  const w = world();
  const mine = branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  git(w.clone, "fetch", "-q", "upstream");
  const left = join(dirOf(w), "work", "rebase-mine");
  mkdirSync(join(dirOf(w), "work"), { recursive: true });
  git(w.clone, "worktree", "add", "-q", "--detach", left, mine);
  git(w.clone, "remote", "remove", "origin");
  const result = await run(w, "rebase");
  expect(result.code).toBe(0);
  expect(result.out).toContain("there is no origin remote to push rebased branches to");
  expect(tip(w, "mine")).toBe(mine);
  expect(existsSync(left)).toBe(false);
  expect(git(w.clone, "worktree", "list")).not.toContain("rebase-mine");
});

test("continuing a rebase run with unmerged files ends its branch as stopped", async () => {
  const w = world();
  branch(w, "first", conflictingLine("FIRST"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["first"]);
  expect((await run(w, "rebase")).code).toBe(2);
  const events: LiveEvent[] = [];
  const again = await runWith(w, { sink: e => void events.push(e) }, "continue");
  expect(again.code).toBe(2);
  expect(again.out).toContain("first still has unmerged files: base.txt");
  expect(eventWords(events).slice(-2)).toEqual(["item rebase first failed stopped", "end ok:false"]);
  expect((await run(w, "rollback")).code).toBe(0);
});
test("a stopped rebase run whose worktree is gone can still be skipped or rolled back", async () => {
  const w = world();
  const stale = branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["stale"]);
  const stopped = await run(w, "rebase");
  const tree = /worktree: (\S+)/.exec(stopped.out)![1];
  rmSync(tree, { recursive: true, force: true });
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(2);
  expect(resumed.out).toContain("is gone");
  expect((await run(w, "rebase", "--skip-branch")).code).toBe(0);
  expect(state(w)).toBeNull();
  expect(tip(w, "stale")).toBe(stale);

  const again = await run(w, "rebase");
  rmSync(/worktree: (\S+)/.exec(again.out)![1], { recursive: true, force: true });
  expect((await run(w, "rollback")).code).toBe(0);
  expect(state(w)).toBeNull();
});

test("remote URLs compare by repository, however they are spelled", () => {
  const same = [
    "git@GitHub.com:Org/Corgi.git",
    "https://github.com/org/corgi",
    "git@github.com:/org/corgi",
    "ssh://git@github.com:22/org/corgi.git/",
  ];
  expect(new Set(same.map(gitTool.repositoryOf))).toEqual(new Set(["github.com/org/corgi"]));
  expect(gitTool.repositoryOf("git@github.com:1234/corgi.git")).toBe("github.com/1234/corgi");
  expect(gitTool.repositoryOf("file:///srv/repo")).toBe(gitTool.repositoryOf("/srv/repo/"));
});

test("a branch that was ahead of its fork copy is still recognized as pending after its rebase", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  git(w.clone, "checkout", "-q", "mine");
  commit(w.clone, { "ahead.txt": "ahead\n" }, "ahead");
  git(w.clone, "checkout", "-q", "main");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  expect((await runWith(w, { ask: () => "n" }, "rebase")).code).toBe(0);
  const again = await runWith(w, { ask: () => "n" }, "rebase");
  expect(again.out).toContain("mine: rebased earlier, push pending");
  expect(again.out).not.toContain("diverged");
});

test("a rebase the user aborted in the stopped worktree is reported as failed, not rebased", async () => {
  const w = world();
  const old = branch(w, "stale", conflictingLine("STALE"));
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["stale"]);
  const stopped = await run(w, "rebase");
  const tree = /worktree: (\S+)/.exec(stopped.out)![1];
  git(tree, "rebase", "--abort");
  const resumed = await run(w, "continue");
  expect(resumed.code).toBe(0);
  expect(resumed.out).toContain("stale: not rebased: the rebase did not complete");
  expect(tip(w, "stale")).toBe(old);
});

test("a leftover directory that is no worktree is removed without touching the user's own rebase", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n", ...conflictingLine("UPSTREAM") });
  configureOwn(w, ["mine"]);
  // The user is in the middle of a rebase of their own in the checkout.
  git(w.clone, "checkout", "-q", "-b", "own", "main");
  commit(w.clone, conflictingLine("OWN"), "own");
  git(w.clone, "fetch", "-q", "upstream");
  Bun.spawnSync(["git", "rebase", "upstream/main"], { cwd: w.clone, stdout: "ignore", stderr: "ignore" });
  expect(gitTool.rebaseInProgress(w.clone)).toBe(true);
  const plain = join(dirOf(w), "work", "rebase-plain");
  mkdirSync(plain, { recursive: true });
  // A worktree of the user's whose directory is away for now keeps its registration.
  const away = join(fresh("away"), "tree");
  git(w.clone, "worktree", "add", "-q", "--detach", away, "main");
  const name = readdirSync(join(commonDirOf(w.clone), "worktrees")).find(n =>
    read(join(commonDirOf(w.clone), "worktrees", n, "gitdir")).includes(away.replace(/^\/private/, "")),
  )!;
  renameSync(away, `${away}-moved`);
  await run(w, "rebase");
  expect(existsSync(plain)).toBe(false);
  expect(gitTool.rebaseInProgress(w.clone)).toBe(true);
  expect(existsSync(join(commonDirOf(w.clone), "worktrees", name))).toBe(true);
});

test("origin fetching upstream and pushing to the fork, with several push URLs, still rebases and pushes", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  git(w.clone, "remote", "remove", "upstream");
  git(w.clone, "remote", "set-url", "origin", w.upstream);
  git(w.clone, "remote", "set-url", "--push", "origin", fork(w));
  git(w.clone, "remote", "set-url", "--add", "--push", "origin", fork(w));
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  const result = await run(w, "rebase", "--push");
  expect(result.code).toBe(0);
  expect(result.out).toContain("pushed mine to origin");
  expect(onFork(w, "mine")).toBe(tip(w, "mine")!);
});

test("a pending push stays offered while its branch is checked out", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  expect((await runWith(w, { ask: () => "n" }, "rebase")).code).toBe(0);
  git(w.clone, "worktree", "add", "-q", join(fresh("busy"), "tree"), "mine");
  const again = await runWith(w, { ask: () => "n" }, "rebase");
  expect(again.out).toContain("mine: rebased earlier, push pending");
  expect(again.out).toContain("push: git push --force-with-lease=refs/heads/mine:");
});

// Rollback and dependencies (FR-036).

/** Install steps that count their runs in a file and fail while `broken` exists. */
test("rebase conflicts are recorded as harness calls, in rebuild and in the rebase command", async () => {
  const rebaseCall = "- 1 call, 1 accepted, tokens unknown\n- stale rebase conflict try 1: accepted, tokens unknown\n";
  for (const command of ["rebuild", "rebase"]) {
    const w = world();
    branch(w, "stale", { "base.txt": "one\nSTALE\nthree\n" });
    upstreamMoves(w, { "base.txt": "one\nUPSTREAM\nthree\n" });
    configureOwn(w, ["stale"], { harness: { command: stubHarness(takeTheirs).command } });
    expect((await run(w, command)).code).toBe(0);
    expect(read(join(latest(w), "report.md"))).toContain(`## Harness\n\n${rebaseCall}`);
  }
});

test("a pinned own branch is never rebased", async () => {
  const w = world();
  const old = branch(w, "mine", { "mine.txt": "mine\n" });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"], { patchExtra: { mine: { pin: old } } });
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(tip(w, "mine")).toBe(old);
  expect(backupOf(w, "mine")).toBeNull();
  expect(stamped(w).map(p => p.commit)).toEqual([old]);
});

test("a pinned branch keeps its commit when another patch rebases the same branch", async () => {
  const w = world();
  const old = ownPullRequest(w, 5, "feature", { "feature.txt": "f\n" });
  git(w.clone, "fetch", "-q", "origin");
  git(w.clone, "branch", "-q", "feature", "origin/feature");
  stubGh(w, { "acme/widget#5": { state: "OPEN", title: "feature", head: "me/widget:feature" } });
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["feature", "#5"], { patchExtra: { feature: { pin: old } } });
  const result = await runWith(w, { ask: () => "n" }, "rebuild");
  expect(result.code).toBe(0);
  expect(behindUpstream(w, "feature")).toBe(false);
  expect(stamped(w).map(p => p.commit)).toEqual([old, tip(w, "feature")!]);
});

test("with origin fetching upstream and pushing to the fork, rebuild uses the fork's newer copy of an own branch", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "checkout", "-q", "mine");
  commit(w.clone, { "more.txt": "more\n" }, "more");
  git(w.clone, "push", "-q", "origin", "mine");
  const pushed = tip(w, "mine")!;
  git(w.clone, "checkout", "-q", "main");
  git(w.clone, "branch", "-q", "-f", "mine", "mine~1");
  git(w.clone, "remote", "remove", "upstream");
  git(w.clone, "remote", "set-url", "origin", w.upstream);
  git(w.clone, "remote", "set-url", "--push", "origin", fork(w));
  configure(w, ["mine"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(stamped(w).map(p => p.commit)).toEqual([pushed]);
});
