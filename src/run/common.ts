import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { Event, RunState } from "../core/runstate";
import * as runstate from "../core/runstate";
import { paths } from "../core/paths";
import * as git from "../git/git";
import { signal as send, type LiveEvent, type Stage } from "../live/events";
import { loadRecipe } from "../recipes/load";
import type { Vars } from "../steps/commands";
import * as timings from "../timings/timings";

export const work = (ctx: Context) => paths.work(ctx.dir);
export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "none");
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A readable merge commit per patch, so the branch's log and the report say what each patch is. */
export const mergeMessage = (p: { display: string; description: string }) =>
  `Merge ${p.display}${p.description ? `: ${p.description}` : ""}`;
export const ms = (ctx: Context) => ctx.now().getTime();
/** `YYYYMMDD-HHMMSS` in UTC. */
export function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}
export function save(ctx: Context, run: RunState) {
  timings.tick(run, ms(ctx));
  runstate.saveRun(ctx.dir, run);
}
export const startItem = (ctx: Context, run: RunState, key: string) => timings.startItem(run, key, ms(ctx));
export const endItem = (ctx: Context, run: RunState, key: string, exceptMs = 0) => timings.endItem(run, key, ms(ctx), exceptMs);
export function event(run: { events: Event[] }, kind: string, fields: Omit<Event, "kind"> = {}) {
  run.events.push({ kind, ...fields });
}
export const signal = (ctx: Context, e: LiveEvent) => send(ctx.sink, e);
export const stage = (ctx: Context, name: Stage, state: "start" | "done", summary?: string) =>
  signal(ctx, { t: "stage", stage: name, state, ...(summary === undefined ? {} : { summary }) });

/** Copies `from` over `to` by renaming a sibling copy into place: a running
 * binary keeps its inode, and the copy may come from another file system. */
export function replaceFile(from: string, to: string) {
  mkdirSync(join(to, ".."), { recursive: true });
  const temporary = `${to}.tmp-${process.pid}`;
  copyFileSync(from, temporary);
  renameSync(temporary, to);
}
/** A new `reports/<timestamp>` directory for a run. */
export function newReportDir(ctx: Context, prefix = ""): string {
  const reports = paths.reports(ctx.dir),
    base = `${prefix}${stamp(ctx.now())}`;
  let name = base;
  for (let n = 2; existsSync(join(reports, name)); n++) name = `${base}-${n}`;
  mkdirSync(join(reports, name), { recursive: true });
  return join(reports, name);
}
/** Paths a fix never includes: debaser's directory when `--dir` puts it inside the checkout. */
export function excluded(ctx: Context): string[] {
  const rel = relative(ctx.repo, ctx.dir);
  return rel && !rel.startsWith("..") && !rel.startsWith("/") ? [rel] : [];
}
export const upstreamLine = (ctx: Context, run: RunState) => git.oneLine(ctx.repo, run.upstream.tip);
/** The patches merged so far, with their merge commits. */
export const mergedPatches = (run: RunState) =>
  run.plan.filter(p => !p.skip && p.merge).map(p => ({ display: p.display, ref: p.commit!, merge: p.merge! }));

/** Placeholders for a step run in `tree`. */
export function stepVars(ctx: Context, tree: string, tests?: string[]): Vars {
  const output = recipeOf(ctx).artifact?.output;
  return { output: resolve(tree, output ?? "debaser-output"), root: tree, ...(tests ? { tests } : {}) };
}
/** The installed artifact's path in the build directory `tree` (absolute paths as is), or null when the recipe installs none. */
export function installPath(ctx: Context, tree = ctx.repo): string | null {
  const install = recipeOf(ctx).artifact?.install;
  return install ? resolve(tree, install) : null;
}
/** Resolves the recipe at `tip` for a run, so the wait at a trust prompt
 * isn't the run's time (FR-048). */
export function loadRunRecipe(ctx: Context, run: RunState, tip: string): void {
  const plain = ctx.ask;
  if (plain) ctx.ask = question => ask({ ...ctx, ask: plain }, run, question) ?? null;
  try {
    loadRecipe(ctx, tip);
  } finally {
    ctx.ask = plain;
  }
}
/** Asks on the terminal; the wait for the answer isn't the run's time. */
export function ask(ctx: Context, run: RunState, question: string): string | null | undefined {
  if (!ctx.ask) return undefined;
  timings.pause(run, ms(ctx));
  try {
    return ctx.ask(question);
  } finally {
    timings.resume(run, ms(ctx));
  }
}
