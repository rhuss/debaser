import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import type { Context } from "../core/context";
import { listOf, recipeOf } from "../core/context";
import { Explained } from "../core/errors";
import * as runstate from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { mergeInProgress } from "../git/merge";
import { loadRecipe } from "../recipes/load";
import { paths } from "../core/paths";
import { prune } from "../report/report";
import { expand } from "../steps/commands";
import { runStep } from "../steps/run";
import { installPath, newReportDir, replaceFile, save, short, stepVars } from "./common";
import * as rebaseRollback from "./rebase-phase";

/** Reruns the recipe's install step after the checkout moved (FR-016). */
async function restoreDependencies(ctx: Context, log: string) {
  const recipe = recipeOf(ctx),
    step = recipe.install && recipe.steps.find(s => s.name === recipe.install!.step);
  if (!step) {
    ctx.task?.("install", "skipped", "no install step");
    return;
  }
  ctx.progress("restoring dependencies after rollback");
  ctx.task?.("install", "running", "restoring dependencies");
  const ok = await runStep(expand(step.run, stepVars(ctx, ctx.repo), step.tests), { cwd: ctx.repo, log, env: ctx.env, echo: ctx.echo, timeout: step.timeout });
  if (!ok) {
    ctx.task?.("install", "failed", `failed; see ${log}`);
    throw new Explained(`dependency restore failed after rollback; see ${log}`, ["  fix it, then run `debaser continue` to finish the rollback"]);
  }
  ctx.task?.("install", "done", "dependencies restored");
}
/** Puts back the artifact saved as `from` (moved away unless `keep`); without
 * one, the run's artifact goes since there was none before. */
function restoreArtifact(ctx: Context, from: string | null, keep: boolean) {
  const target = installPath(ctx);
  if (!target) return;
  const shown = relative(ctx.repo, target);
  ctx.task?.("artifact", "running");
  if (from && existsSync(from)) {
    replaceFile(from, target);
    if (!keep) rmSync(from, { force: true });
    ctx.task?.("artifact", "done", `${shown} restored`);
  } else if (!from && existsSync(target)) {
    rmSync(target, { force: true });
    ctx.task?.("artifact", "done", `${shown} removed; there was none before`);
  } else ctx.task?.("artifact", "skipped", "no saved artifact");
}

/** Returns to the last successful build: the start of a stopped run, else the
 * backups (FR-016). A rebase run is ended instead. */
export async function rollback(ctx: Context): Promise<Outcome> {
  const { repo } = ctx,
    list = listOf(ctx),
    run = runstate.loadRun(ctx.dir);
  if (run?.kind === "rebase") return rebaseRollback.rollbackRebase(ctx, run);
  loadRecipe(ctx, run?.upstream?.tip);
  if (run) {
    // The forced checkout below discards the run's half-done work, which lives
    // only on the integration branch; edits anywhere else are someone else's.
    const current = git.currentBranch(repo);
    if (current !== list.branch && !git.isClean(repo))
      throw new Explained(`${current ?? "the detached HEAD"} has uncommitted changes, and rollback would discard them; commit or stash them first`);
    run.phase = "rollback";
    save(ctx, run);
    ctx.task?.("undo", "running");
    if (mergeInProgress(repo)) git.git(repo, ["merge", "--abort"]);
    if (run.startTip) {
      git.must(repo, ["checkout", "--quiet", "-f", "-B", list.branch, run.startTip]);
      ctx.task?.("undo", "done", `${list.branch} back at ${short(run.startTip)}`);
    } else {
      git.must(repo, ["checkout", "--quiet", "-f", run.startBranch ?? run.startHead]);
      const drop = run.startBranch !== list.branch && git.branchExists(repo, list.branch);
      if (drop) git.must(repo, ["branch", "-D", list.branch]);
      ctx.task?.("undo", "done", `${run.startBranch ?? short(run.startHead)} checked out${drop ? `, ${list.branch} deleted` : ""}`);
    }
    if (run.startArtifact && existsSync(run.startArtifact)) restoreArtifact(ctx, run.startArtifact, false);
    else if (!run.startArtifact) restoreArtifact(ctx, null, false);
    await restoreDependencies(ctx, join(run.reportDir, "steps", "rollback-install.log"));
    runstate.clearRun(ctx.dir);
    return {
      code: 0,
      lines: [
        run.startTip
          ? `debaser: rolled back to ${list.branch} at ${short(run.startTip)}, as before the run`
          : `debaser: rolled back to ${run.startBranch ?? short(run.startHead)}; there was no build before the run`,
      ],
    };
  }
  const prev = git.revParse(repo, `refs/heads/${list.branch}-prev`),
    target = installPath(ctx),
    prevArtifact = target ? `${target}.prev` : null;
  if (!prev && !(prevArtifact && existsSync(prevArtifact)))
    throw new Explained("nothing to roll back to: no stopped run and no earlier build");
  if (!git.isClean(repo)) throw new Explained("tracked files have uncommitted changes; commit or stash them first");
  if (prev) {
    ctx.task?.("undo", "running");
    git.must(repo, ["checkout", "--quiet", "-B", list.branch, prev]);
    ctx.task?.("undo", "done", `${list.branch} back at ${list.branch}-prev (${short(prev)})`);
  }
  if (prevArtifact && existsSync(prevArtifact)) restoreArtifact(ctx, prevArtifact, true);
  if (prev) {
    await restoreDependencies(ctx, join(newReportDir(ctx, "rollback-"), "steps", "install.log"));
    prune(paths.reports(ctx.dir));
  }
  return {
    code: 0,
    lines: [
      `debaser: rolled back to ${list.branch}-prev (${short(prev)})${prevArtifact && existsSync(prevArtifact) ? ` and ${relative(repo, prevArtifact)}` : ""}`,
    ],
  };
}
