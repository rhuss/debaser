import { existsSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Context } from "../core/context";
import { listOf, recipeOf } from "../core/context";
import type { Code } from "../core/errors";
import * as runstate from "../core/runstate";
import type { RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { writeReport } from "../report/report";
import { runStep } from "../steps/run";
import * as timings from "../timings/timings";
import { endItem, installPath, ms, replaceFile, short, stage, startItem } from "./common";
import { endRun } from "./end";
import * as rebasePhase from "./rebase-phase";

/** Adds a finished run to the timings history; a history that can't be
 * written is a warning, the run's outcome stands (FR-048). */
export function recordTimings(ctx: Context, run: RunState) {
  try {
    timings.tick(run, ms(ctx));
    timings.record(ctx.dir, timings.historyRun(run, run.kind, false, ctx.now()));
  } catch (error) {
    ctx.progress(`warning: could not record timings: ${(error as Error).message}`);
  }
}

/** Ends a fully successful run (FR-008a, FR-010, FR-011): installs the build
 * output with the replaced copy kept as `.prev`, moves `<branch>-prev` to the
 * run's start, runs the after-build command and pushes when asked. */
export async function finish(ctx: Context, run: RunState): Promise<Outcome> {
  const { repo } = ctx,
    list = listOf(ctx),
    recipe = recipeOf(ctx),
    target = installPath(ctx),
    output = recipe.artifact?.output ? resolve(repo, recipe.artifact.output) : null,
    warnings: string[] = [];
  const pushed = await rebasePhase.offerPush(ctx, run);
  // The installed copy changes only now, after every check passed.
  let installed: string | null = null,
    previous: string | null = null;
  if (target && output) {
    if (existsSync(output)) {
      replaceFile(output, target);
      installed = target;
      if (run.startArtifact && existsSync(run.startArtifact)) {
        replaceFile(run.startArtifact, `${target}.prev`);
        previous = `${target}.prev`;
      } else rmSync(`${target}.prev`, { force: true });
    } else warnings.push(`warning: the build output ${relative(repo, output)} does not exist; nothing was installed`);
  }
  for (const w of warnings) ctx.progress(w);
  // The backups are the run's start, both halves, so a rollback never mixes builds.
  if (run.startTip) git.must(repo, ["branch", "-f", `${list.branch}-prev`, run.startTip]);
  else if (git.branchExists(repo, `${list.branch}-prev`)) git.must(repo, ["branch", "-D", `${list.branch}-prev`]);
  const built = installed ? relative(repo, installed) : list.branch,
    lines = [...summary(ctx, run, built), ...warnings.map(w => `  ${w}`), ...pushed.lines],
    brief = [...attention(run), ...pushed.lines.filter(l => l.startsWith("  push: ")), ...warnings.map(w => `  ${w}`)],
    reason: string[] = [];
  let code: Code = pushed.refused ? 1 : 0;
  if (pushed.refused) reason.push("a push of a rebased branch was refused");
  if (recipe.afterBuild) {
    startItem(ctx, run, "after-build");
    stage(ctx, "after-build", "start");
    ctx.progress(`running after-build command: ${recipe.afterBuild.join(" ")}`);
    const ok = await runStep(recipe.afterBuild, { cwd: repo, log: join(run.reportDir, "steps", "after-build.log"), env: ctx.env, echo: ctx.echo });
    endItem(ctx, run, "after-build");
    stage(ctx, "after-build", "done", ok ? "passed" : "failed");
    lines.push(ok ? "after-build command: passed" : "warning: the after-build command failed; the build itself succeeded");
    if (!ok) brief.push("  warning: the after-build command failed; the build itself succeeded");
  }
  if (run.push) {
    startItem(ctx, run, "push");
    stage(ctx, "push", "start");
    ctx.progress(`pushing ${list.branch} to origin`);
    const out = git.git(repo, ["push", "--force-with-lease", "origin", `${list.branch}:${list.branch}`]);
    endItem(ctx, run, "push");
    stage(ctx, "push", "done", out.code === 0 ? `pushed ${list.branch}` : `push of ${list.branch} failed`);
    if (out.code === 0) lines.push(`pushed ${list.branch} to origin`);
    else {
      const why = (out.stderr || out.stdout).trim();
      lines.push(`push to origin failed: ${why}`);
      brief.push(`  warning: push to origin failed: ${why}`);
      reason.push(`the push of ${list.branch} to origin failed`);
      code = 1;
    }
  }
  // The report and result.json carry the final exit code, push included.
  const handoffs = await writeReport(ctx, run, code, reason, { artifact: { installed, previous } });
  lines.push(...handoffs.map(path => `  handoff: ${path}`));
  runstate.clearRun(ctx.dir);
  if (run.startArtifact) rmSync(run.startArtifact, { force: true });
  recordTimings(ctx, run);
  return endRun(ctx, run, { code, lines, brief, handoffs: handoffs.length, ...(installed ? { artifact: installed } : {}) });
}

/** What of a finished run needs the user on a short summary. */
function attention(run: RunState): string[] {
  const of = (kind: string) => run.events.filter(e => e.kind === kind);
  return [
    ...rebasePhase.attention(run.rebased ?? []),
    ...of("rebase-note").map(e => `  note: ${e.detail}`),
    ...of("skipped-merged").map(e => `  note: ${e.patch} is merged upstream; remove it from the list`),
    ...of("closed-warning").map(e => `  warning: ${e.patch} ${e.detail}`),
    ...of("warning").map(e => `  warning: ${e.patch}: ${e.detail}`),
    ...of("note").map(e => `  note: ${e.patch}: ${e.detail}`),
  ];
}
function summary(ctx: Context, run: RunState, built: string): string[] {
  const of = (kind: string) => run.events.filter(e => e.kind === kind).map(e => e.patch ?? e.step ?? "");
  return [
    `debaser: built ${built} on upstream ${short(run.upstream.tip)} with ${run.merged.length} ${run.merged.length === 1 ? "patch" : "patches"}`,
    ...rebasePhase.lines(run.rebased ?? []).map(line => `  ${line}`),
    ...run.events.filter(e => e.kind === "rebase-note").map(e => `  note: ${e.detail}`),
    ...run.merged.map(p => `  merged ${p.source} ${p.commit.slice(0, 7)} ${p.description}`),
    ...of("skipped-merged").map(p => `  skipped ${p}: merged upstream, it can be removed from the list`),
    ...of("skipped-contained").map(p => `  skipped ${p}: already contained`),
    ...of("agent-resolved").map(p => `  agent resolved the conflict in ${p}`),
    ...run.fixes.map(f => `  ${f.by === "agent" ? "agent" : "user"} fix ${f.commit.slice(0, 7)} for ${f.acceptance ? `the acceptance check of ${f.acceptance}` : f.step}`),
    ...run.events
      .filter(e => e.kind === "flaky")
      .map(e => `  warning: ${e.patch ? `the acceptance check of ${e.patch}` : e.step} failed once and passed when run again; it may be flaky (${e.detail})`),
    ...run.events.filter(e => e.kind === "closed-warning").map(e => `  warning: ${e.patch} ${e.detail}`),
    ...run.events.filter(e => e.kind === "warning").map(e => `  warning: ${e.patch}: ${e.detail}`),
    ...run.events.filter(e => e.kind === "note").map(e => `  note: ${e.patch}: ${e.detail}`),
    `  report: ${join(run.reportDir, "report.md")}`,
  ];
}
