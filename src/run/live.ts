import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import type { RunState } from "../core/runstate";
import * as git from "../git/git";
import { afterBuildOf } from "../recipes/types";
import type { Stage, Upstream } from "../live/events";
import * as liveState from "../live/state";
import type { HarnessKind } from "../plugins/harness/types";
import { display } from "../plugins/sources/parse";
import * as timings from "../timings/timings";
import { patchLink } from "../views/list";
import { ms, signal } from "./common";

/** What the live events of a run need beyond its state, kept while a sink listens. */
type Live = { history: timings.History; planning: liveState.Planning };
const lives = new WeakMap<RunState, Live>();
function liveOf(ctx: Context, run: RunState): Live {
  let l = lives.get(run);
  if (!l) lives.set(run, (l = { history: timings.loadHistory(ctx.dir), planning: {} }));
  return l;
}
const stepNames = (ctx: Context) => ctx.recipe?.steps.map(s => s.name) ?? [];
const harnessKind = (ctx: Context) => (listOf(ctx).harness?.kind as HarnessKind | undefined) ?? null;

/** Sends the run's estimate as it stands now. */
export function sendEstimate(ctx: Context, run: RunState) {
  if (!ctx.sink) return;
  const l = liveOf(ctx, run);
  timings.tick(run, ms(ctx));
  signal(ctx, { t: "estimate", estimate: liveState.liveEstimate(run, listOf(ctx), stepNames(ctx), l.history, l.planning) });
}
/** The upstream as the view's header names it: how many commits it has beyond the last build. */
export function upstreamOf(ctx: Context, run: RunState, tip: string): Upstream {
  const list = listOf(ctx),
    base = run.startTip ?? git.revParse(ctx.repo, `refs/heads/${list.branch}`),
    count = base && tip ? git.git(ctx.repo, ["rev-list", "--count", "--no-merges", `${base}..${tip}`]).stdout : "0";
  return { name: `${upstreamRemote(ctx)}/${list.upstream.branch}`, tip, newCommits: Number(count) || 0 };
}
/** Each patch's page, as `list` links it. */
export function patchLinks(ctx: Context): Record<string, string> {
  const fork = git.hasRemote(ctx.repo, "origin") ? git.git(ctx.repo, ["remote", "get-url", "--push", "origin"]).stdout.trim() : null,
    links: Record<string, string> = {};
  for (const p of listOf(ctx).patches) {
    const url = patchLink(p.source, fork ? fork.replace(/^https?:\/\/|^git@|\.git$/g, "").replace(":", "/") : null);
    if (url) links[display(p.source)] = url;
  }
  return links;
}
/** Each step's log, for its name in the view. */
export function stepLinks(ctx: Context, run: RunState): Record<string, string> {
  if (!run.reportDir) return {};
  return Object.fromEntries(stepNames(ctx).map(step => [step, pathToFileURL(resolve(run.reportDir, "steps", `${step}.log`)).href]));
}
/** Starts the live events of a new run, before its fetch. */
export function begin(ctx: Context, run: RunState, stages: Stage[]) {
  if (!ctx.sink) return;
  const list = listOf(ctx),
    l = liveOf(ctx, run),
    known = git.revParse(ctx.repo, `refs/remotes/${upstreamRemote(ctx)}/${list.upstream.branch}`) ?? "";
  signal(ctx, {
    t: "begin",
    command: run.kind,
    rebaseRun: run.kind === "rebase",
    branch: list.branch,
    upstream: upstreamOf(ctx, run, known),
    stages,
    items:
      run.kind === "build"
        ? {
            merge: list.patches.map(p => display(p.source)),
            ...(stepNames(ctx).length ? { verify: stepNames(ctx) } : {}),
            accept: list.patches.filter(p => p.acceptance).map(p => display(p.source)),
          }
        : {},
    estimate: liveState.liveEstimate(run, list, stepNames(ctx), l.history),
    links: patchLinks(ctx),
    harness: harnessKind(ctx),
    harnessMedianMs: timings.harnessMedian(l.history, run.kind),
    elapsedMs: 0,
  });
  signal(ctx, { t: "stage", stage: "fetch", state: "start" });
}
/** Ends the fetch stage with the upstream it fetched. */
export function fetched(ctx: Context, run: RunState, patches: number | null) {
  if (!ctx.sink) return;
  const upstream = upstreamOf(ctx, run, run.upstream.tip),
    commits = `${upstream.newCommits} upstream commit${upstream.newCommits === 1 ? "" : "s"}`;
  signal(ctx, {
    t: "stage",
    stage: "fetch",
    state: "done",
    summary: patches === null ? commits : `${commits}, ${patches} ${patches === 1 ? "patch" : "patches"}`,
    upstream,
  });
  sendEstimate(ctx, run);
}
/** Replays a stopped run's events before it goes on (`continue`). */
export function replay(ctx: Context, run: RunState, command: "continue" | "rebase") {
  if (!ctx.sink) return;
  for (const e of liveState.fromRun(run, listOf(ctx), stepNames(ctx), {
    history: liveOf(ctx, run).history,
    command,
    upstream: upstreamOf(ctx, run, run.upstream.tip),
    links: { ...patchLinks(ctx), ...(run.kind === "rebase" ? {} : stepLinks(ctx, run)) },
    afterBuild: !!afterBuildOf(ctx.recipe),
    install: ctx.recipe?.install?.step ?? null,
    harness: harnessKind(ctx),
  }))
    signal(ctx, e);
}
export const stagesFor = (ctx: Context, run: RunState, rebasing: boolean) => liveState.stagesOf(run, !!afterBuildOf(ctx.recipe), rebasing);
