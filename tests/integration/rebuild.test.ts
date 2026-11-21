import { expect, test, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquire } from "../../src/core/lock";
import * as runstate from "../../src/core/runstate";
import { linkLatest, prune } from "../../src/report/report";
import {
  branch,
  commit,
  configure,
  dirOf,
  forkBranch,
  fresh,
  git,
  head,
  installPath,
  latest,
  noGh,
  pullRequest,
  read,
  refs,
  run,
  stamped,
  state,
  stubGh,
  stubSteps,
  subjects,
  write,
  world,
} from "../support/world";

setDefaultTimeout(120_000);

test("rebuild merges an own branch, an upstream PR, a fork PR and a fork branch in order", async () => {
  const w = world();
  const mine = branch(w, "mine", { "mine.txt": "mine\n" }),
    pr = pullRequest(w, "acme/widget", 1, { "pr1.txt": "one\n" }),
    forkPr = pullRequest(w, "other/widget", 2, { "pr2.txt": "two\n" }),
    topic = forkBranch(w, "other/widget", "topic", { "topic.txt": "topic\n" });
  stubGh(w, {
    "acme/widget#1": { state: "OPEN", title: "viewer: one" },
    "other/widget#2": { state: "OPEN", title: "two" },
  });
  configure(w, ["mine", "#1", "other/widget#2", "other/widget:topic"]);
  const before = refs(w);
  const result = await run(w, "rebuild");
  expect(result.err).not.toContain("debaser: cannot");
  expect(result.code).toBe(0);
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
  expect(subjects(w, "upstream/main..HEAD")).toEqual([
    "Merge other/widget:topic: about other/widget:topic",
    "Merge other/widget#2: about other/widget#2",
    "Merge acme/widget#1: about #1",
    "Merge mine: about mine",
  ]);
  expect(stamped(w)).toEqual([
    { source: "mine", commit: mine, description: "about mine" },
    { source: "acme/widget#1", commit: pr, description: "about #1" },
    { source: "other/widget#2", commit: forkPr, description: "about other/widget#2" },
    { source: "other/widget:topic", commit: topic, description: "about other/widget:topic" },
  ]);
  expect(result.out).toContain("with 4 patches");
  expect(state(w)).toBeNull();
  // Patch branches and upstream are untouched; no remotes were added.
  expect(refs(w)).toBe(before);
  expect(git(w.clone, "remote").split("\n").sort()).toEqual(["origin", "upstream"]);
  expect(git(w.clone, "status", "--porcelain")).toBe("");
  // A report and the machine-readable result.
  expect(existsSync(join(latest(w), "report.md"))).toBe(true);
  const result_ = JSON.parse(read(join(latest(w), "result.json")));
  expect(result_).toMatchObject({ version: 1, command: "rebuild", outcome: "success", exitCode: 0 });
  expect(result_.patches.map((p: { display: string; state: string }) => [p.display, p.state])).toEqual([
    ["mine", "merged"],
    ["acme/widget#1", "merged"],
    ["other/widget#2", "merged"],
    ["other/widget:topic", "merged"],
  ]);
});

test("rebuild refuses a dirty checkout or a stopped run and changes nothing", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  write(w.clone, { "base.txt": "edited\n" });
  const dirty = await run(w, "rebuild");
  expect(dirty.code).toBe(1);
  expect(dirty.err).toContain("uncommitted changes");
  expect(git(w.clone, "branch", "--list", "debaser")).toBe("");
  git(w.clone, "checkout", "--", "base.txt");
  // Untracked files don't make it dirty.
  write(w.clone, { "notes.md": "mine\n" });
  runstate.saveRun(dirOf(w), { phase: "merge" } as runstate.RunState);
  const stopped = await run(w, "rebuild");
  expect(stopped.code).toBe(1);
  expect(stopped.err).toContain("`continue`");
  expect(git(w.clone, "branch", "--list", "debaser")).toBe("");
  runstate.clearRun(dirOf(w));
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(read(join(w.clone, "notes.md"))).toBe("mine\n");
});

test("a patch that can't be fetched stops the run before anything is reset", async () => {
  const w = world();
  noGh(w);
  configure(w, ["#99"]);
  const start = head(w),
    result = await run(w, "rebuild");
  expect(result.code).toBe(1);
  expect(result.err).toContain("cannot fetch acme/widget#99");
  expect(head(w)).toBe(start);
  expect(git(w.clone, "branch", "--list", "debaser")).toBe("");
  expect(state(w)).toBeNull();
});

test("merged and contained patches are skipped, closed PRs merged with a warning", async () => {
  const w = world();
  const lower = branch(w, "lower", { "lower.txt": "lower\n" });
  branch(w, "stacked", { "stacked.txt": "stacked\n" }, "lower");
  pullRequest(w, "acme/widget", 3, { "pr3.txt": "three\n" });
  pullRequest(w, "acme/widget", 4, { "pr4.txt": "four\n" });
  pullRequest(w, "acme/widget", 5, { "pr5.txt": "five\n" });
  // #3 landed on upstream main as a squash commit, so its head isn't an ancestor.
  const squash = commit(w.seed, { "pr3.txt": "three\n" }, "pr 3 (squashed)");
  git(w.seed, "push", "-q", w.upstream, "HEAD:main");
  stubGh(w, {
    "acme/widget#3": { state: "MERGED", title: "merged one", mergeCommit: squash },
    "acme/widget#4": { state: "CLOSED", title: "closed one" },
    // Merged per GitHub, but into a commit the fetched main lacks.
    "acme/widget#5": { state: "MERGED", title: "merged elsewhere", mergeCommit: "0".repeat(40) },
  });
  configure(w, ["stacked", "lower", "#3", "#4", "#5"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(result.out).toContain("skipped acme/widget#3: merged upstream, it can be removed from the list");
  expect(result.out).toContain("skipped lower: already contained");
  expect(result.out).toContain("warning: acme/widget#4");
  expect(result.out).toContain("note: acme/widget#5: the PR is merged, but not into the fetched main; merging it");
  expect(stamped(w).map(p => p.source)).toEqual(["stacked", "acme/widget#4", "acme/widget#5"]);
  expect(git(w.clone, "merge-base", "--is-ancestor", lower, "HEAD")).toBe("");
  const patches = JSON.parse(read(join(latest(w), "result.json"))).patches;
  expect(patches.find((p: { display: string }) => p.display === "acme/widget#3").state).toBe("skipped-merged");
  expect(patches.find((p: { display: string }) => p.display === "lower").state).toBe("skipped-contained");
});

test("a PR merged on another repository is still merged; one merged upstream is skipped", async () => {
  const w = world();
  pullRequest(w, "other/widget", 5, { "pr5.txt": "five\n" });
  stubGh(w, { "other/widget#5": { state: "MERGED", title: "merged in the fork" } });
  configure(w, ["other/widget#5"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(stamped(w).map(p => p.source)).toEqual(["other/widget#5"]);
});

test("the after-build command runs only after a successful run", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  branch(w, "bad", { "bad.txt": "BROKEN\n" });
  const marker = join(fresh("after"), "ran");
  configure(w, ["mine"], { afterBuild: ["sh", "-c", `echo ran >> ${marker}`] });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(read(marker)).toBe("ran\n");
  configure(w, ["mine", "bad"], { afterBuild: ["sh", "-c", `echo ran >> ${marker}`] });
  expect((await run(w, "rebuild")).code).toBe(3);
  expect(read(marker)).toBe("ran\n");
});

test("a successful run keeps the previous build as -prev", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  expect((await run(w, "rebuild")).code).toBe(0);
  const first = head(w),
    firstArtifact = read(installPath(w));
  expect(git(w.clone, "branch", "--list", "debaser-prev")).toBe("");
  expect(existsSync(`${installPath(w)}.prev`)).toBe(false);
  git(w.clone, "checkout", "-q", "mine");
  commit(w.clone, { "mine.txt": "mine 2\n" });
  git(w.clone, "checkout", "-q", "debaser");
  expect((await run(w, "rebuild")).code).toBe(0);
  const secondArtifact = read(installPath(w));
  expect(secondArtifact).not.toBe(firstArtifact);
  expect(git(w.clone, "rev-parse", "debaser-prev")).toBe(first);
  expect(read(`${installPath(w)}.prev`)).toBe(firstArtifact);
  // With no run, rollback restores the backups.
  const back = await run(w, "rollback");
  expect(back.code).toBe(0);
  expect(head(w)).toBe(first);
  expect(read(installPath(w))).toBe(firstArtifact);
  expect(git(w.clone, "branch", "--show-current")).toBe("debaser");
});

test("rollback with nothing built says so", async () => {
  const w = world();
  configure(w, []);
  const result = await run(w, "rollback");
  expect(result.code).toBe(1);
  expect(result.err).toContain("nothing to roll back to");
});

test("rebuild --push sends the custom branch to origin; a plain rebuild never pushes", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  const fork = join(w.github, "me/widget.git");
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(git(w.clone, "ls-remote", fork, "refs/heads/debaser")).toBe("");
  const pushed = await run(w, "rebuild", "--push");
  expect(pushed.code).toBe(0);
  expect(pushed.out).toContain("pushed debaser to origin");
  expect(git(w.clone, "ls-remote", fork, "refs/heads/debaser")).toStartWith(head(w));
  expect(git(w.clone, "ls-remote", w.upstream, "refs/heads/debaser")).toBe("");
});

test("rebuild refuses a patch named like a branch it resets, and --push to upstream under another name", async () => {
  const w = world();
  branch(w, "debaser-prev", { "prev.txt": "prev\n" });
  configure(w, ["debaser-prev"]);
  const start = head(w),
    taken = await run(w, "rebuild");
  expect(taken.code).toBe(1);
  expect(taken.err).toContain("the patch debaser-prev is a branch debaser resets");
  expect(head(w)).toBe(start);
  expect(state(w)).toBeNull();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  // origin pushes to upstream, spelled with a trailing slash.
  git(w.clone, "remote", "set-url", "--push", "origin", `${w.upstream}/`);
  const pushed = await run(w, "rebuild", "--push");
  expect(pushed.code).toBe(1);
  expect(pushed.err).toContain("--push needs an origin remote of your own");
  expect(git(w.clone, "ls-remote", w.upstream, "refs/heads/debaser")).toBe("");
});

test("a custom branch checked out in another worktree is refused before anything changes", async () => {
  const w = world();
  configure(w, []);
  git(w.clone, "branch", "debaser", "main");
  git(w.clone, "worktree", "add", "-q", join(fresh("wt"), "elsewhere"), "debaser");
  const result = await run(w, "rebuild");
  expect(result.code).toBe(1);
  expect(result.err).toContain("checked out in another worktree");
  expect(state(w)).toBeNull();
});

test("reports/latest follows the newest run and only ten runs and ten rollback logs are kept", () => {
  const reports = fresh("reports");
  const names = Array.from({ length: 12 }, (_, i) => `20261104-1000${String(i).padStart(2, "0")}`);
  names.push("20261104-100011-2");
  const rollbacks = Array.from({ length: 11 }, (_, i) => `rollback-20261104-1100${String(i).padStart(2, "0")}`);
  for (const name of [...names, ...rollbacks]) mkdirSync(join(reports, name));
  linkLatest(reports, join(reports, "20261104-100011-2"));
  linkLatest(reports, join(reports, "20261104-100011-2"));
  prune(reports);
  expect(readlinkSync(join(reports, "latest"))).toBe("20261104-100011-2");
  expect(readdirSync(reports).sort()).toEqual([...names.slice(3), ...rollbacks.slice(1), "latest"].sort());
});

test("an own branch behind its pushed copy uses the pushed one; a diverged one uses local with a warning", async () => {
  const w = world();
  branch(w, "behind", { "behind.txt": "1\n" });
  git(w.clone, "push", "-q", "origin", "behind");
  git(w.clone, "checkout", "-q", "behind");
  const ahead = commit(w.clone, { "behind.txt": "2\n" });
  git(w.clone, "push", "-q", "origin", "behind");
  git(w.clone, "reset", "-q", "--hard", "HEAD^");
  branch(w, "diverged", { "diverged.txt": "1\n" });
  git(w.clone, "push", "-q", "origin", "diverged");
  git(w.clone, "checkout", "-q", "diverged");
  commit(w.clone, { "diverged.txt": "pushed\n" });
  git(w.clone, "push", "-q", "-f", "origin", "diverged");
  git(w.clone, "reset", "-q", "--hard", "HEAD^");
  const local = commit(w.clone, { "diverged.txt": "local\n" });
  git(w.clone, "checkout", "-q", "main");
  configure(w, ["behind", "diverged"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(result.out).toContain("note: behind: local branch is behind origin/behind; using origin/behind");
  expect(result.out).toContain("warning: diverged: local branch and origin/diverged have diverged; using the local branch");
  expect(stamped(w).map(p => p.commit)).toEqual([ahead, local]);
});

test("an own branch known only from a stale origin copy stops instead of building the old commit", async () => {
  const w = world();
  branch(w, "gone", { "gone.txt": "gone\n" });
  git(w.clone, "push", "-q", "origin", "gone");
  git(w.clone, "branch", "-q", "-D", "gone");
  // Deleted on origin; the clone still has refs/remotes/origin/gone.
  git(join(w.github, "me/widget.git"), "update-ref", "-d", "refs/heads/gone");
  configure(w, ["gone"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(1);
  expect(result.err).toContain("cannot fetch origin/gone for gone");
  expect(state(w)).toBeNull();
});

test("rebuild, continue and rollback refuse while another command holds the lock, which a throwing command releases", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  // Another live process (this runner's parent) holds the lock.
  writeFileSync(join(dirOf(w), "lock"), JSON.stringify({ pid: process.ppid, command: "rebuild", startedAt: "2026-11-04T10:00:00Z" }));
  for (const verb of ["rebuild", "continue", "rollback"]) {
    const refused = await run(w, verb);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`another debaser command is running in this checkout: rebuild (pid ${process.ppid}`);
  }
  // Read-only commands take no lock.
  expect((await run(w, "list")).code).toBe(0);
  rmSync(join(dirOf(w), "lock"));
  // A command that throws (nothing to continue) leaves no lock behind.
  expect((await run(w, "continue")).code).toBe(1);
  expect(existsSync(join(dirOf(w), "lock"))).toBe(false);
  const release = acquire(dirOf(w), "test");
  release();
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(existsSync(join(dirOf(w), "lock"))).toBe(false);
});

test("a rebuild with no live patches builds plain upstream", async () => {
  const w = world();
  configure(w, []);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(head(w)).toBe(git(w.clone, "rev-parse", "upstream/main"));
  expect(read(installPath(w))).toBe("");
  expect(result.out).toContain("with 0 patches");
});

test("build steps see the patch list, the fork URL and the integration commit, and a manifest", async () => {
  const w = world();
  const mine = branch(w, "mine", { "mine.txt": "mine\n" });
  const seen = join(fresh("env"), "env");
  configure(w, ["mine"], {
    steps: [
      ...stubSteps,
      {
        name: "stamp",
        run: ["sh", "-c", `printf '%s\\n%s\\n%s\\n%s\\n' "$DEBASER_PATCHES" "$DEBASER_FORK_URL" "$DEBASER_COMMIT" "$DEBASER_MANIFEST" > ${seen}`],
      },
    ],
  });
  expect((await run(w, "rebuild")).code).toBe(0);
  const [patches, forkUrl, commitSha, manifest] = read(seen).trimEnd().split("\n");
  expect(JSON.parse(patches)).toEqual([{ source: { kind: "branch", name: "mine" }, display: "mine", commit: mine }]);
  expect(forkUrl).toBe(join(w.github, "me/widget.git"));
  expect(commitSha).toBe(head(w));
  expect(manifest).toBe(join(dirOf(w), "manifest.json"));
  expect(JSON.parse(read(manifest))).toMatchObject({
    version: 1,
    upstream: { repo: "acme/widget", branch: "main", tip: git(w.clone, "rev-parse", "upstream/main") },
    commit: head(w),
    fork: join(w.github, "me/widget.git"),
    patches: [{ source: { kind: "branch", name: "mine" }, display: "mine", commit: mine }],
  });
});

test("rebuild --json prints the machine-readable result", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  const result = await run(w, "rebuild", "--json");
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.out);
  expect(parsed).toEqual(JSON.parse(read(join(latest(w), "result.json"))));
  expect(parsed).toMatchObject({ command: "rebuild", outcome: "success", exitCode: 0 });
  expect(parsed.artifact).toEqual({ installed: realpathSync(installPath(w)), previous: null });
  expect(parsed.patches[0]).toMatchObject({ display: "mine", state: "merged", acceptance: "unverified" });
  expect(parsed.steps.map((s: { name: string; result: string }) => `${s.name}:${s.result}`)).toEqual([
    "install:pass",
    "typecheck:pass",
    "test:pass",
    "build:pass",
  ]);
});

test("a pinned patch merges exactly its pinned commit", async () => {
  const w = world();
  const first = branch(w, "mine", { "mine.txt": "1\n" });
  git(w.clone, "checkout", "-q", "mine");
  commit(w.clone, { "mine.txt": "2\n" });
  git(w.clone, "checkout", "-q", "main");
  configure(w, ["mine"], { patchExtra: { mine: { pin: first } } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(stamped(w).map(p => p.commit)).toEqual([first]);
});

test("no matching recipe stops with the recipes debaser has", async () => {
  const w = world();
  configure(w, []);
  rmSync(join(dirOf(w), "recipe.toml"));
  const result = await run(w, "rebuild");
  expect(result.code).toBe(1);
  expect(result.err).toContain("no recipe matches this project; debaser has bun-ts, rust-cargo");
  expect(state(w)).toBeNull();
  expect(git(w.clone, "branch", "--list", "debaser")).toBe("");
});

test("a failed push of the integration branch ends with 1, and the result says so", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  git(w.clone, "remote", "set-url", "--push", "origin", join(fresh("nowhere"), "missing.git"));
  const result = await run(w, "rebuild", "--push", "--json");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out)).toMatchObject({ outcome: "failed", exitCode: 1 });
  expect(JSON.parse(read(join(latest(w), "result.json")))).toMatchObject({ outcome: "failed", exitCode: 1 });
});

test("--push is refused when any of origin's push URLs is upstream", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  configure(w, ["mine"]);
  git(w.clone, "remote", "set-url", "--add", "--push", "origin", join(w.github, "me/widget.git"));
  git(w.clone, "remote", "set-url", "--add", "--push", "origin", `file://${w.upstream}`);
  const pushed = await run(w, "rebuild", "--push");
  expect(pushed.code).toBe(1);
  expect(pushed.err).toContain("--push needs an origin remote of your own");
  expect(git(w.clone, "ls-remote", w.upstream, "refs/heads/debaser")).toBe("");
});

test("without gh a PR is still merged, with a warning that its state is unknown", async () => {
  const w = world();
  pullRequest(w, "acme/widget", 3, { "pr3.txt": "three\n" });
  noGh(w);
  configure(w, ["#3"]);
  const result = await run(w, "rebuild");
  expect(result.code).toBe(0);
  expect(result.out + result.err).toContain("gh could not tell the PR's state (is gh installed and signed in?)");
  expect(read(join(latest(w), "report.md"))).toContain("gh could not tell the PR's state");
});

test("the install step runs when nothing is installed or a trigger file changed, and is skipped otherwise", async () => {
  const w = world();
  branch(w, "mine", { "mine.txt": "mine\n" });
  const count = join(fresh("installs"), "count");
  configure(w, ["mine"], {
    install: { step: "install", triggers: ["package.json"], marker: "installed.marker" },
    steps: [{ name: "install", run: ["sh", "-c", `touch installed.marker; echo x >> "${count}"`] }, ...stubSteps.filter(s => s.name !== "install")],
  });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(read(count)).toBe("x\n");
  // Installed, and package.json unchanged: skipped.
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(read(count)).toBe("x\n");
  // Upstream changes a trigger file: installed again.
  commit(w.seed, { "package.json": '{"name":"widget"}\n' }, "deps change");
  git(w.seed, "push", "-q", w.upstream, "HEAD:main");
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(read(count)).toBe("x\nx\n");
});

test("a pinned PR merged upstream by squash is still merged at its pin, and survives its source going away", async () => {
  const w = world();
  const pinned = pullRequest(w, "acme/widget", 3, { "pr3.txt": "three\n" });
  const squash = commit(w.seed, { "pr3.txt": "three\n" }, "pr 3 (squashed)");
  git(w.seed, "push", "-q", w.upstream, "HEAD:main");
  stubGh(w, { "acme/widget#3": { state: "MERGED", title: "merged one", mergeCommit: squash } });
  configure(w, ["#3"], { patchExtra: { "#3": { pin: pinned } } });
  expect((await run(w, "rebuild")).code).toBe(0);
  expect(stamped(w).map(p => p.commit)).toEqual([pinned]);
  expect(read(join(latest(w), "report.md"))).toContain("doesn't contain the pinned commit, so merging it");
  // The PR ref is gone upstream; the pinned commit is still known.
  git(w.seed, "push", "-q", w.upstream, ":refs/pull/3/head");
  const again = await run(w, "rebuild");
  expect(again.code).toBe(0);
  expect(again.out + again.err).toContain("using the pinned commit");
  expect(stamped(w).map(p => p.commit)).toEqual([pinned]);
});
