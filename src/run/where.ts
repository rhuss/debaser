import type { Context } from "../core/context";
import { Explained } from "../core/errors";
import type { RunState } from "../core/runstate";

/** Where a stopped run is, and the commands that go on from there. A run file
 * cut short (an interrupted save) still gets an answer. */
export function whereStopped(run: RunState): { where: string; next: string } {
  const at = run.plan?.[run.cursor],
    where =
      run.kind === "rebase"
        ? `rebasing ${run.rebaseStop?.target.branch ?? "own branches"}${run.rebaseStop ? ` in ${run.rebaseStop.worktree}` : ""}`
        : run.phase === "merge"
          ? at
            ? `merging ${at.display} (${run.cursor + 1} of ${run.plan.length})`
            : "merging patches"
          : run.phase === "verify"
            ? `verifying (${run.step ?? "the first step"})`
            : run.phase === "accept"
              ? "running acceptance checks"
              : run.phase === "rollback"
                ? "rolling back and restoring dependencies"
                : "writing the report",
    next =
      run.kind === "rebase"
        ? run.rebaseStop
          ? "debaser continue, debaser continue --skip-branch, or debaser rollback"
          : "debaser continue, or debaser rollback"
        : run.phase === "rollback"
          ? "debaser continue (finishes the rollback)"
          : run.stopped?.code === 4
            ? "debaser rollback, then build once upstream is fixed"
            : "debaser continue, or debaser rollback";
  return { where, next };
}
/** The refusal to start while `run` is stopped or in progress. */
export function inProgress(ctx: Context, run: RunState): Explained {
  const { where, next } = whereStopped(run),
    since = run.startedAt ? Date.parse(run.startedAt) : NaN,
    ago = Number.isNaN(since) ? "" : `, started ${span(ctx.now().getTime() - since)} ago`;
  return new Explained(
    "a run is stopped or in progress; resume it with `continue` or undo it with `rollback`",
    [`  stopped: while ${where}${ago}`, ...(run.reportDir ? [`  report: ${run.reportDir}`] : []), `  next: ${next}`],
    "a run is stopped or in progress",
  );
}
/** `2h 05m`, `12m` or `40s`. */
export function span(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000)),
    h = Math.floor(t / 3600),
    m = Math.floor((t % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return m ? `${m}m` : `${t}s`;
}
