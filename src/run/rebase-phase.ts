import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import type { Code } from "../core/errors";
import { Explained } from "../core/errors";
import type { RebaseMode } from "../core/patchlist";
import * as runstate from "../core/runstate";
import type { RebaseResult, RebaseStop, RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git";
import { harnessFor } from "../harness/select";
import { loadRecipe } from "../recipes/load";
import * as rebase from "../rebase/rebase";
import { stepEnv } from "../report/manifest";
import { writeReport } from "../report/report";
import * as timings from "../timings/timings";
import { ask, loadRunRecipe, endItem, event, ms, newReportDir, plural, save, short, signal, stage, startItem, work } from "./common";
import { endRun } from "./end";
import { recordUse } from "./harness-common";
import { recordTimings } from "./finish";
import { inProgress } from "./where";
import * as live from "./live";
import { rebaseItem, rebaseSummary } from "../live/state";

/** What rebasing needs from a run. */
function envOf(ctx: Context, run: RunState): rebase.Env {
  const list = listOf(ctx);
  return {
    ctx,
    repo: ctx.repo,
    workDir: work(ctx),
    config: list,
    env: ctx.env,
    echo: ctx.echo,
    progress: ctx.progress,
    upstream: run.upstream.tip,
    upstreamRemote: upstreamRemote(ctx),
    reportDir: run.reportDir,
    stepEnv: tree => stepEnv(ctx, run, tree),
    nextCall: () => ++run.calls,
    onUse: use => recordUse(ctx, run, use),
    harness: harnessFor(ctx, "rebase"),
    signal: ctx.sink,
  };
}


/** Rebuild's rebase phase (FR-031): rebases the own branches before the reset
 * and merges their new tips; a branch that can't be rebased keeps its old tip
 * and gets a handoff, and the run goes on (FR-035). */
export async function beforeRebuild(ctx: Context, run: RunState, mode: RebaseMode, inWorktree: boolean): Promise<void> {
  // A rebase never stops a rebuild, and an interrupted one leaves each branch at a checked tip.
  rebase.cleanLeftovers({ repo: ctx.repo, workDir: work(ctx) });
  if (mode === "off") return;
  const e = envOf(ctx, run);
  stage(ctx, "rebase", "start");
  const skip = new Set(run.plan.filter(p => p.skip).map(p => p.display)),
    chosen = rebase.select(e, mode, { skip, fetch: true, inWorktree });
  if (chosen.note) event(run, "rebase-note", { detail: chosen.note });
  run.rebased = chosen.results;
  for (const r of chosen.results) signal(ctx, rebaseItem(r));
  for (const t of chosen.targets) {
    startItem(ctx, run, `rebase:${t.branch}`);
    signal(ctx, { t: "item", stage: "rebase", id: t.branch, state: "start" });
    // No run state exists yet: an interruption puts a branch rebased in its own
    // worktree back at its checked tip itself (FR-013), as rollback would.
    const forget = git.onInterrupt(() => {
      const undone = rebase.undoInterrupted(t);
      if (undone) process.stderr.write(`debaser: ${undone}\n`);
    });
    let r;
    try {
      r = await rebase.rebaseTarget(e, t, { stopOnConflict: false });
    } finally {
      forget();
    }
    endItem(ctx, run, `rebase:${t.branch}`);
    if (!("result" in r)) throw Error(`the rebase of ${t.branch} stopped inside rebuild, which never stops`);
    run.rebased.push(r.result);
    signal(ctx, rebaseItem(r.result));
  }
  stage(ctx, "rebase", "done", rebaseSummary(run.rebased));
  // Build what the own branches now hold: rebased in this run, or in an earlier
  // one and not pushed yet; every patch naming the branch gets its new tip.
  for (const r of run.rebased) {
    const p = run.plan.find(p => p.display === r.patch),
      moved = run.rebased.find(m => m.branch === r.branch && m.to && (m.outcome === "rebased" || m.pending));
    if (p && moved) {
      p.commit = moved.to!;
      p.ref = `refs/heads/${r.branch}`;
    }
  }
  // A patch naming the same branch as another one gets its new tip too; a
  // pinned one keeps its commit (FR-053).
  for (const p of run.plan) {
    const name = p.source.kind === "branch" && !p.pin ? p.source.name : null,
      moved = name ? run.rebased.find(m => m.branch === name && m.to && (m.outcome === "rebased" || m.pending)) : null;
    if (moved) p.commit = moved.to!;
  }
}


/** Pushes the branches this run rebased when `--push` or a yes on the
 * terminal says so, otherwise prints how (FR-033). */
export async function offerPush(ctx: Context, run: RunState): Promise<{ lines: string[]; refused: boolean }> {
  const moved = (run.rebased ?? []).filter(r => (r.outcome === "rebased" || r.pending) && r.to && !r.push);
  if (!moved.length) return { lines: [], refused: false };
  // Harness fixes on rebased branches are shown before any push (FR-031a).
  for (const r of moved)
    if (r.fixes?.length)
      ctx.progress(`review ${r.branch} before pushing: the harness fixed its checks in ${r.fixes.map(c => short(c)).join(", ")} (git show ${short(r.fixes[0])})`);
  const names = moved.map(r => r.branch).join(", "),
    n = moved.length,
    answer = run.push ? "y" : ask(ctx, run, `Force-push ${n} rebased branch${n === 1 ? "" : "es"} to origin (${names})? [y/N] `);
  if (!/^y(es)?$/i.test(answer?.trim() ?? "")) return { lines: moved.map(r => `  push: ${rebase.pushCommand(r)}`), refused: false };
  startItem(ctx, run, "push");
  stage(ctx, "push", "start");
  ctx.progress(`pushing ${names} to origin`);
  const lines = rebase.push(ctx.repo, run.reportDir, moved);
  endItem(ctx, run, "push");
  stage(ctx, "push", "done", `${plural(moved.filter(r => r.push === "pushed").length, "branch", "branches")} pushed`);
  return { lines, refused: moved.some(r => r.push === "refused") };
}
export const attention = (rebased: RebaseResult[]) => rebase.attention(rebased);
export const lines = (rebased: RebaseResult[]) => rebase.lines(rebased, { current: false });

/** `debaser rebase` (FR-031 to FR-035a): rebases the own branches onto upstream
 * and nothing else; stops at a conflict the harness can't resolve. */
export async function rebaseCommand(ctx: Context, o: { rebase?: RebaseMode; push?: boolean; inWorktree?: boolean } = {}): Promise<Outcome> {
  const { repo } = ctx,
    list = listOf(ctx);
  git.requireVersion(repo);
  const busy = runstate.loadRun(ctx.dir);
  if (busy) throw inProgress(ctx, busy);
  const remote = upstreamRemote(ctx);
  if (!git.hasRemote(repo, remote)) throw new Explained(`no ${remote} remote to fetch upstream from`);
  const run: RunState = {
    kind: "rebase",
    startedAt: ctx.now().toISOString(),
    reportDir: "",
    startTip: null,
    startHead: git.head(repo),
    startBranch: git.currentBranch(repo),
    startArtifact: null,
    upstream: { ref: `refs/remotes/${remote}/${list.upstream.branch}`, tip: "" },
    phase: "rebase",
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
    rebased: [],
    rebaseTargets: [],
    rebaseCursor: 0,
    rebaseStop: null,
  };
  timings.resume(run, ms(ctx));
  try {
    loadRecipe(ctx, null, { peek: true });
  } catch {}
  live.begin(ctx, run, live.stagesFor(ctx, run, true));
  startItem(ctx, run, "fetch");
  ctx.progress(`fetching ${remote} ${list.upstream.branch}`);
  run.upstream.tip = git.fetchRemote(repo, remote, list.upstream.branch);
  loadRunRecipe(ctx, run, run.upstream.tip);
  run.reportDir = newReportDir(ctx);
  const e = envOf(ctx, run);
  rebase.cleanLeftovers(e);
  const chosen = rebase.select(e, o.rebase ?? list.rebase ?? "all", { skip: new Set(), fetch: true, inWorktree: !!o.inWorktree });
  endItem(ctx, run, "fetch");
  live.fetched(ctx, run, null);
  if (chosen.note) event(run, "rebase-note", { detail: chosen.note });
  run.rebased = chosen.results;
  run.rebaseTargets = chosen.targets;
  save(ctx, run);
  stage(ctx, "rebase", "start");
  for (const r of chosen.results) signal(ctx, rebaseItem(r));
  return rebaseLoop(ctx, run);
}

async function rebaseLoop(ctx: Context, run: RunState): Promise<Outcome> {
  const e = envOf(ctx, run),
    targets = run.rebaseTargets ?? [];
  while ((run.rebaseCursor ?? 0) < targets.length) {
    const t = targets[run.rebaseCursor ?? 0];
    startItem(ctx, run, `rebase:${t.branch}`);
    signal(ctx, { t: "item", stage: "rebase", id: t.branch, state: "start" });
    const r = await rebase.rebaseTarget(e, t, { stopOnConflict: true });
    if ("stop" in r) return rebaseStopped(ctx, run, r.stop, r.exhausted);
    recordRebase(ctx, run, r.result);
  }
  stage(ctx, "rebase", "done", rebaseSummary(run.rebased ?? []));
  const pushed = await offerPush(ctx, run),
    code: Code = pushed.refused ? 1 : 0,
    handoffs = await writeReport(ctx, run, code, pushed.refused ? ["a push of a rebased branch was refused"] : []);
  runstate.clearRun(ctx.dir);
  recordTimings(ctx, run);
  const shown = rebase.lines(run.rebased ?? [], { current: false });
  return endRun(ctx, run, {
    code,
    lines: [
      `debaser: rebased own branches onto upstream ${short(run.upstream.tip)}`,
      ...(shown.length ? shown.map(line => `  ${line}`) : ["  nothing to rebase"]),
      ...run.events.filter(e => e.kind === "rebase-note").map(e => `  note: ${e.detail}`),
      ...pushed.lines,
      ...handoffs.map(path => `  handoff: ${path}`),
      `  report: ${join(run.reportDir, "report.md")}`,
    ],
    brief: [
      ...rebase.attention(run.rebased ?? []),
      ...run.events.filter(e => e.kind === "rebase-note").map(e => `  note: ${e.detail}`),
      ...pushed.lines.filter(l => l.startsWith("  push: ")),
    ],
    handoffs: handoffs.length,
  });
}
function recordRebase(ctx: Context, run: RunState, result: RebaseResult) {
  // A branch the run stopped at counts the active time on both sides of the stop.
  endItem(ctx, run, `rebase:${result.branch}`);
  (run.rebased ??= []).push(result);
  run.rebaseCursor = (run.rebaseCursor ?? 0) + 1;
  run.rebaseStop = null;
  run.stopped = null;
  save(ctx, run);
  signal(ctx, rebaseItem(result));
}
async function rebaseStopped(ctx: Context, run: RunState, stop: RebaseStop, exhausted: boolean): Promise<Outcome> {
  const code: Code = exhausted ? 5 : 2,
    at = git.must(stop.worktree, ["log", "-1", "--format=%h %s", stop.commit]),
    what = `${exhausted ? "the harness could not resolve the rebase conflict" : "rebase conflict"} in ${stop.target.branch} at ${at}`;
  run.rebaseStop = stop;
  run.stopped = { code, snapshot: {} };
  save(ctx, run);
  signal(ctx, { t: "item", stage: "rebase", id: stop.target.branch, state: "failed", outcome: "stopped", detail: what });
  await writeReport(ctx, run, code, [what]);
  return endRun(ctx, run, {
    code,
    lines: [
      `debaser stopped: ${what}`,
      ...(stop.problem ? [`  problem: ${stop.problem}`] : []),
      `  files: ${stop.files.join(", ") || "none unmerged"}`,
      `  worktree: ${stop.worktree}`,
      `  report: ${join(run.reportDir, "report.md")}`,
      "  resolve the conflicts in the worktree and `git add` the files, then: debaser continue",
      "  skip this branch: debaser continue --skip-branch",
      "  end the rebase run: debaser rollback",
    ],
  });
}

/** Continues a stopped rebase run; `skip` gives up the branch it stopped at. */
export async function resumeRebase(ctx: Context, run: RunState, skip: boolean): Promise<Outcome> {
  loadRecipe(ctx, run.upstream.tip);
  live.replay(ctx, run, skip ? "rebase" : "continue");
  const stop = run.rebaseStop;
  if (skip && stop) {
    rebase.abandon(envOf(ctx, run), stop);
    recordRebase(ctx, run, {
      patch: stop.target.patch,
      branch: stop.target.branch,
      from: stop.target.from,
      to: null,
      lease: stop.target.lease,
      outcome: "skipped",
      reason: "skipped with --skip-branch",
    });
    return rebaseLoop(ctx, run);
  }
  if (stop) {
    const stopped = (detail: string) => signal(ctx, { t: "item", stage: "rebase", id: stop.target.branch, state: "failed", outcome: "stopped", detail });
    if (!existsSync(stop.worktree)) {
      stopped(`the worktree ${stop.worktree} is gone`);
      return endRun(ctx, run, {
        code: 2,
        lines: [
          `debaser: the worktree ${stop.worktree} for ${stop.target.branch} is gone`,
          "  skip the branch: debaser continue --skip-branch, or end the run: debaser rollback",
        ],
      });
    }
    const left = git.unmergedFiles(stop.worktree);
    if (left.length) {
      stopped(`unmerged files: ${left.join(", ")}`);
      return endRun(ctx, run, {
        code: 2,
        lines: [`debaser: ${stop.target.branch} still has unmerged files: ${left.join(", ")}`, `  resolve them in ${stop.worktree} and \`git add\` them, then continue`],
      });
    }
    const r = await rebase.resumeTarget(envOf(ctx, run), stop);
    if ("stop" in r) return rebaseStopped(ctx, run, r.stop, r.exhausted);
    recordRebase(ctx, run, r.result);
  } else {
    // Interrupted before it recorded a result, the branch at the cursor may have
    // moved in its own worktree without passing its checks: put it back first.
    const active = run.rebaseTargets?.[run.rebaseCursor ?? 0],
      undone = active ? rebase.undoInterrupted(active) : null;
    if (undone) ctx.progress(undone);
  }
  return rebaseLoop(ctx, run);
}

/** Ends a rebase run (FR-035): branches rebased before the stop keep their new
 * tips and backups; the branch it stopped at goes back. */
export async function rollbackRebase(ctx: Context, run: RunState): Promise<Outcome> {
  // Interrupted before it recorded a result, the branch at the cursor may have
  // moved in its own worktree without passing its checks.
  ctx.task?.("undo", "running");
  const active = run.rebaseStop ? null : run.rebaseTargets?.[run.rebaseCursor ?? 0],
    undone = active ? rebase.undoInterrupted(active) : null;
  if (run.rebaseStop) rebase.abandon({ repo: ctx.repo }, run.rebaseStop);
  rebase.cleanLeftovers({ repo: ctx.repo, workDir: work(ctx) });
  ctx.task?.("undo", "done", run.rebaseStop ? `${run.rebaseStop.target.branch}'s rebase abandoned` : "rebase run ended");
  runstate.clearRun(ctx.dir);
  // A stopped run offers no push; the branches it moved still need one.
  const moved = (run.rebased ?? []).filter(r => (r.outcome === "rebased" || r.pending) && r.to && !r.push);
  return {
    code: 0,
    lines: [
      "debaser: ended the rebase run; branches rebased before the stop keep their new tips and backups",
      ...(undone ? [`  ${undone}`] : []),
      ...rebase.lines(run.rebased ?? [], { current: false }).map(line => `  ${line}`),
      ...moved.map(r => `  push: ${rebase.pushCommand(r)}`),
    ],
  };
}
