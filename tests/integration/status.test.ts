import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  branch,
  commit,
  configure,
  configureOwn,
  conflictingLine,
  dirOf,
  fresh,
  git,
  latest,
  ownPullRequest,
  pullRequest,
  run,
  stubGh,
  stubHarness,
  takeTheirs,
  upstreamMoves,
  world,
} from "../support/world";

setDefaultTimeout(180_000);

test("status reads an older result.json that says unverified as none", async () => {
  const w = world();
  branch(w, "plain", { "plain.txt": "plain\n" });
  configure(w, ["plain"]);
  expect((await run(w, "build")).code).toBe(0);
  const path = join(latest(w), "result.json"),
    saved = readFileSync(path, "utf8");
  expect(saved).toContain('"acceptance": "none"');
  writeFileSync(path, saved.replace('"acceptance": "none"', '"acceptance": "unverified"'));
  const text = await run(w, "status");
  expect(text.out).toMatch(/^plain .* pass +-$/m);
  expect(text.out).not.toContain("unverified");
  expect(JSON.parse((await run(w, "status", "--json")).out).patches[0].acceptance).toBe("none");
});

test("status reports a check added after the last build as not run yet, not as none", async () => {
  const w = world();
  branch(w, "plain", { "plain.txt": "plain\n" });
  configure(w, ["plain"]);
  expect((await run(w, "build")).code).toBe(0);
  configure(w, ["plain"], { patchExtra: { plain: { acceptance: { run: ["true"] } } } });
  expect(JSON.parse((await run(w, "status", "--json")).out).patches[0].acceptance).toBeNull();
  expect((await run(w, "status")).out).toMatch(/^plain .* pass +-$/m);
});

test("status reads origin from git's own ref, so a branch force-pushed by hand isn't diverged", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  git(w.clone, "push", "-q", "origin", "mine");
  upstreamMoves(w, { "up.txt": "up\n" });
  configureOwn(w, ["mine"]);
  // A run records origin's tip; then the branch is rebased and force-pushed by hand.
  expect((await run(w, "build")).code).toBe(0);
  git(w.clone, "fetch", "-q", "upstream");
  git(w.clone, "checkout", "-q", "-b", "redo", "upstream/main");
  commit(w.clone, { "mine.txt": "mine again\n" }, "mine: change");
  git(w.clone, "branch", "-q", "-f", "mine", "redo");
  git(w.clone, "push", "-q", "-f", "origin", "mine");
  const status = await run(w, "status");
  expect(status.out).toMatch(/mine +✓ clean +✓ up to date/);
});

test("status checks an own PR's rebased branch against upstream, not the PR as last fetched", async () => {
  const w = world();
  ownPullRequest(w, 5, "feature", conflictingLine("FEATURE"));
  stubGh(w, { "acme/widget#5": { state: "OPEN", title: "feature", head: "me/widget:feature" } });
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  configureOwn(w, ["#5"], { harness: { command: stubHarness(takeTheirs).command } });
  // A build's copy of the PR and of upstream, from before the rebase.
  git(w.clone, "fetch", "-q", "upstream");
  git(w.clone, "fetch", "-q", w.upstream, "refs/pull/5/head:refs/debaser/acme/widget/pull/5");
  const before = await run(w, "status");
  expect(before.out).toMatch(/acme\/widget#5 +✗ 1 conflict/);
  expect((await run(w, "rebase", "--push")).code).toBe(0);
  const after = await run(w, "status");
  expect(after.out).toMatch(/acme\/widget#5 +✓ clean +✓ up to date/);
});

test("status lists own branches behind, conflicting with or left alone by upstream", async () => {
  const w = world();
  branch(w, "clean", { "clean.txt": "clean\n" });
  branch(w, "stale", conflictingLine("STALE"));
  branch(w, "busy", { "busy.txt": "busy\n" });
  git(w.clone, "worktree", "add", "-q", join(fresh("busy"), "tree"), "busy");
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  git(w.clone, "fetch", "-q", "upstream");
  configureOwn(w, ["clean", "stale", "busy"]);
  const shown = await run(w, "status");
  expect(shown.out).toMatch(/^clean +✓ clean +! behind upstream +not a PR /m);
  expect(shown.out).toMatch(/^stale +✗ 1 conflict +✗ behind, conflicts +not a PR /m);
  expect(shown.out).toMatch(/^busy +✓ clean +· in worktree \S*tree +not a PR /m);
  expect(shown.out).toContain("Branches behind upstream: `rebase` updates them.");
  expect(shown.out).toContain("Branches in a worktree: `rebase --in-worktree` rebases them there.");
  expect(shown.out).not.toContain("\x1b[");
});

test("status shows PR states, pins, the last results and upstream drift as text and JSON, changing nothing", async () => {
  const w = world();
  const mine = branch(w, "mine", { "mine.txt": "mine\n" });
  pullRequest(w, "acme/widget", 3, { "pr3.txt": "three\n" });
  pullRequest(w, "acme/widget", 4, { "pr4.txt": "four\n" });
  stubGh(w, { "acme/widget#3": { state: "OPEN", title: "three" }, "acme/widget#4": { state: "CLOSED", title: "four" } });
  configure(w, ["mine", "#3", "#4"], {
    patchExtra: { mine: { pin: mine }, "#3": { acceptance: { run: ["true"] } } },
  });
  expect((await run(w, "build")).code).toBe(0);
  upstreamMoves(w, { "up1.txt": "1\n" });
  upstreamMoves(w, { "up2.txt": "2\n" });
  git(w.clone, "fetch", "-q", "upstream");
  const refsBefore = git(w.clone, "for-each-ref"),
    statusBefore = git(w.clone, "status", "--porcelain");
  // A held lock doesn't stop status; nothing is fetched without --fetch.
  writeFileSync(join(dirOf(w), "lock"), JSON.stringify({ pid: process.ppid, command: "build", startedAt: "x" }));
  upstreamMoves(w, { "up3.txt": "3\n" });
  const text = await run(w, "status");
  expect(text.code).toBe(0);
  // The live lock holder is shown as running, with no continue or rollback hint.
  expect(text.out).toContain(`running: build (pid ${process.ppid})`);
  expect(text.out).not.toContain("continue");
  expect(text.out).toContain("2 upstream commits since the last build");
  // One table: merge state, own branch, PR and last results on one row per patch.
  expect(text.out).toMatch(/^PATCH +UPSTREAM +OWN BRANCH +PR +BEHIND +CHECKS +ACCEPTANCE/m);
  expect(text.out.match(/^PATCH /gm)).toHaveLength(1);
  expect(text.out).toMatch(/^mine +✓ clean +.* not a PR +2 +pass +- +pinned [0-9a-f]{7}$/m);
  expect(text.out).not.toContain("unverified");
  expect(text.out).toMatch(/^acme\/widget#3 +✓ clean +.* open +2 +pass +pass/m);
  expect(text.out).toMatch(/^acme\/widget#4 +.* closed/m);
  const json = await run(w, "status", "--json");
  const parsed = JSON.parse(json.out);
  expect(parsed.upstream.newCommitsSinceBuild).toBe(2);
  expect(parsed.patches.map((p: { display: string; pr: string | null; merges: boolean; acceptance: string }) => [p.display, p.pr, p.merges, p.acceptance])).toEqual([
    ["mine", null, true, "none"],
    ["acme/widget#3", "OPEN", true, "pass"],
    ["acme/widget#4", "CLOSED", true, "none"],
  ]);
  expect(parsed.patches[0].pinned).toBe(mine);
  expect(git(w.clone, "for-each-ref")).toBe(refsBefore);
  expect(git(w.clone, "status", "--porcelain")).toBe(statusBefore);
  // --fetch reads the newest upstream.
  const fetched = await run(w, "status", "--fetch");
  expect(fetched.out).toContain("3 upstream commits since the last build");
});

test("status keeps the last build's results after a rebase run", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configureOwn(w, ["mine"], { patchExtra: { mine: { acceptance: { run: ["true"] } } } });
  expect((await run(w, "build")).code).toBe(0);
  upstreamMoves(w, { "up1.txt": "1\n" });
  expect((await run(w, "rebase")).code).toBe(0);
  const text = await run(w, "status");
  expect(text.code).toBe(0);
  expect(text.out).toMatch(/^mine +.* not a PR +\S+ +pass +pass/m);
});

test("a lock left by a process that is gone is not shown as a running command", async () => {
  const w = world();
  configure(w, ["#1"]);
  pullRequest(w, "acme/widget", 1, { "one.txt": "1\n" });
  expect((await run(w, "build")).code).toBe(0);
  writeFileSync(join(dirOf(w), "lock"), JSON.stringify({ pid: 2 ** 22 + 12345, command: "build", startedAt: "x" }));
  const shown = await run(w, "status");
  expect(shown.out).toContain("no run in progress");
  expect(shown.out).not.toContain("running:");
  expect(JSON.parse((await run(w, "status", "--json")).out).running).toBeNull();
});
