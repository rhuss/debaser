import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import { Explained } from "../core/errors";
import type { RebaseMode } from "../core/patchlist";
import * as runstate from "../core/runstate";
import type { RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { worktreeWith } from "../git/worktree";
import { display } from "../plugins/sources/parse";
import { loadRecipe } from "../recipes/load";
import * as timings from "../timings/timings";
import { endItem, installPath, loadRunRecipe, ms, newReportDir, save, short, signal, stage, startItem, work } from "./common";
import { fetchPatch } from "./fetch";
import { finish } from "./finish";
import { mergeLoop } from "./mergeloop";
import { verifyLoop } from "./verifyloop";
import * as acceptPhase from "./accept";
import * as rebasePhase from "./rebase-phase";
import { forkProblem } from "./preflight";
import * as live from "./live";
import { configured } from "../harness/select";
import { inProgress } from "./where";

export type BuildOptions = { push?: boolean; rebase?: RebaseMode; inWorktree?: boolean };

/** The checks `build` and `rebase` share; returns the upstream remote. */
export function preflight(ctx: Context, o: { push?: boolean }): string {
  const { repo } = ctx,
    list = listOf(ctx);
  // The run resets the integration branch and replaces its backup, so neither may be a patch.
  const owned = [list.branch, `${list.branch}-prev`],
    taken = list.patches.find(p => p.source.kind === "branch" && owned.includes(p.source.name));
  if (taken)
    throw new Explained(
      `the patch ${display(taken.source)} is a branch debaser resets (${owned.join(", ")}); rename it or set another branch`,
    );
  const remote = upstreamRemote(ctx);
  if (!git.hasRemote(repo, remote)) throw new Explained(`no ${remote} remote to fetch upstream from`, [`  add it: git remote add ${remote} <url>`]);
  // The destinations decide, not the names: origin may fetch upstream and push to the fork.
  if (o.push && forkProblem(ctx)) throw new Explained("--push needs an origin remote of your own, apart from upstream; nothing was changed");
  return remote;
}

/** Starts a full run: preflight, fetch everything, reset the integration
 * branch to upstream, merge, verify, accept and finish (FR-005 to FR-011). */
export async function build(ctx: Context, o: BuildOptions = {}): Promise<Outcome> {
  const { repo } = ctx,
    list = listOf(ctx);
  git.requireVersion(repo);
  const busy = runstate.loadRun(ctx.dir);
  if (busy) throw inProgress(ctx, busy);
  if (!git.isClean(repo)) throw new Explained("tracked files have uncommitted changes; commit or stash them first");
  if (list.branch === list.upstream.branch || !git.validBranchName(repo, list.branch))
    throw new Explained(`${list.branch} can't be the integration branch`);
  const elsewhere = worktreeWith(repo, list.branch);
  if (elsewhere) throw new Explained(`${list.branch} is checked out in another worktree (${elsewhere}); switch it away first`);
  const remote = preflight(ctx, o);
  const run: RunState = {
    kind: "build",
    startedAt: ctx.now().toISOString(),
    reportDir: "",
    startTip: git.revParse(repo, `refs/heads/${list.branch}`),
    startHead: git.head(repo),
    startBranch: git.currentBranch(repo),
    startArtifact: null,
    upstream: { ref: `refs/remotes/${remote}/${list.upstream.branch}`, tip: "" },
    phase: "merge",
    cursor: 0,
    step: null,
    attempts: 0,
    calls: 0,
    plan: [],
    merged: [],
    events: [],
    conflicts: [],
    fixes: [],
    acceptance: [],
    stopped: null,
    push: !!o.push,
  };
  const mode = o.rebase ?? list.rebase ?? "all";
  timings.resume(run, ms(ctx));
  // The view's plan comes from the recipe as last known; the run resolves it again after the fetch.
  try {
    loadRecipe(ctx, null, { peek: true });
  } catch {}
  live.begin(ctx, run, live.stagesFor(ctx, run, mode !== "off"));
  startItem(ctx, run, "fetch");
  ctx.progress(`fetching ${remote} ${list.upstream.branch}`);
  run.upstream.tip = git.fetchRemote(repo, remote, list.upstream.branch);
  // The recipe comes from the fetched upstream, never from a patch (FR-042).
  loadRunRecipe(ctx, run, run.upstream.tip);
  for (const patch of list.patches) {
    ctx.progress(`fetching ${display(patch.source)}`);
    run.plan.push(fetchPatch(ctx, patch, run));
  }
  endItem(ctx, run, "fetch");
  live.fetched(ctx, run, run.plan.length);
  mkdirSync(work(ctx), { recursive: true });
  const installed = installPath(ctx);
  if (installed && existsSync(installed)) {
    run.startArtifact = join(work(ctx), "artifact.start");
    copyFileSync(installed, run.startArtifact);
  }
  run.reportDir = newReportDir(ctx);
  await rebasePhase.beforeBuild(ctx, run, mode, !!o.inWorktree);
  save(ctx, run);
  ctx.progress(`resetting ${list.branch} to ${remote}/${list.upstream.branch} (${short(run.upstream.tip)})`);
  try {
    git.must(repo, ["checkout", "--quiet", "-B", list.branch, run.upstream.tip]);
  } catch (error) {
    // Nothing was reset: forget the run so the checkout is as it was.
    if (run.startArtifact) rmSync(run.startArtifact, { force: true });
    runstate.clearRun(ctx.dir);
    throw error;
  }
  return proceed(ctx, run);
}

/** Runs the phases from where the run is. */
export async function proceed(ctx: Context, run: RunState): Promise<Outcome> {
  if (run.phase === "merge") {
    const stopped = await mergeLoop(ctx, run);
    if (stopped) return stopped;
    run.phase = "verify";
    run.step = null;
    save(ctx, run);
  }
  while (run.phase === "verify" || run.phase === "accept") {
    if (run.phase === "verify") {
      const stopped = await verifyLoop(ctx, run);
      if (stopped) return stopped;
      run.phase = "accept";
      run.acceptCursor = 0;
      save(ctx, run);
    }
    const accepted = await acceptPhase.acceptLoop(ctx, run);
    if (accepted === "again") {
      // An acceptance fix reruns every step, builds and reruns the checks.
      run.phase = "verify";
      run.step = null;
      save(ctx, run);
      continue;
    }
    if (accepted) return accepted;
    run.phase = "report";
    save(ctx, run);
  }
  return finish(ctx, run);
}
