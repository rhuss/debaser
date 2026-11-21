import type { Context } from "../core/context";
import type { Planned, RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { commitMerge, mergeInProgress, mergeNoFF, mergeTreeCheck, unmergedFiles } from "../git/merge";
import { endItem, event, mergeMessage, save, signal, stage, startItem } from "./common";
import { conflictHint, stop } from "./stop";
import * as harnessMerge from "./harness-merge";
import { sendEstimate } from "./live";

/** Records a patch's merge (or skip) and moves on. */
export function advance(ctx: Context, run: RunState, p: Planned, kind: string) {
  // The merge's own time: the harness calls resolving its conflict are timed apart.
  const harnessMs = (run.harnessUsage ?? [])
    .filter(u => u.kind === "conflict" && u.patch === p.display)
    .reduce((total, u) => total + u.seconds * 1000, 0);
  endItem(ctx, run, `merge:${p.display}`, harnessMs);
  const skipped = kind === "skipped-merged" || kind === "skipped-contained";
  if (!skipped) {
    run.merged.push({ source: p.display, commit: p.commit!, description: p.description });
    p.merge = git.head(ctx.repo);
  }
  event(run, kind, { patch: p.display });
  run.cursor++;
  run.attempts = 0;
  save(ctx, run);
  signal(ctx, { t: "item", stage: "merge", id: p.display, state: skipped ? "skipped" : "done", outcome: kind });
  sendEstimate(ctx, run);
}
export function resolved(run: RunState, p: Planned, by: "user" | "harness") {
  const conflict = run.conflicts.findLast(c => c.patch === p.display);
  if (conflict) conflict.by = by;
}

/** Merges the planned patches in order onto the reset branch (FR-006): recorded
 * resolutions replay first, then the conflict harness, else a stop with exit 2. */
export async function mergeLoop(ctx: Context, run: RunState): Promise<Outcome | null> {
  const { repo } = ctx;
  stage(ctx, "merge", "start");
  while (run.cursor < run.plan.length) {
    const p = run.plan[run.cursor];
    if (p.skip === "merged") {
      ctx.progress(`skipping ${p.display}: merged upstream`);
      advance(ctx, run, p, "skipped-merged");
      continue;
    }
    if (p.skip === "contained" || git.isAncestor(repo, p.commit!, "HEAD")) {
      p.skip = "contained";
      ctx.progress(`skipping ${p.display}: already contained`);
      advance(ctx, run, p, "skipped-contained");
      continue;
    }
    startItem(ctx, run, `merge:${p.display}`);
    signal(ctx, { t: "item", stage: "merge", id: p.display, state: "start" });
    ctx.progress(`merging ${p.display}`);
    const out = mergeNoFF(repo, p.commit!, mergeMessage(p));
    if (out.code === 0) {
      advance(ctx, run, p, "merged");
      continue;
    }
    if (!mergeInProgress(repo)) throw Error(`merging ${p.display} failed: ${(out.stderr || out.stdout).trim()}`);
    // A merge the user aborted is merged again here; its unresolved clash is replaced, not listed twice.
    run.conflicts = run.conflicts.filter(c => c.patch !== p.display || c.by !== null);
    const unmerged = unmergedFiles(repo);
    if (unmerged.length === 0) {
      // rerere replayed a recorded resolution for every conflict.
      run.conflicts.push({ patch: p.display, files: mergeTreeCheck(repo, "HEAD", p.commit!).files, by: "rerere" });
      commitMerge(repo, mergeMessage(p));
      advance(ctx, run, p, "replayed");
      continue;
    }
    run.conflicts.push({ patch: p.display, files: unmerged, by: null });
    run.attempts = 0;
    save(ctx, run);
    const handled = await harnessMerge.resolveConflict(ctx, run, p, unmerged);
    if (handled === "resolved") continue;
    if (handled) return handled;
    signal(ctx, { t: "item", stage: "merge", id: p.display, state: "failed", outcome: "stopped", detail: `merge conflict in ${unmerged.join(", ")}` });
    return stop(ctx, run, 2, [`merge conflict in ${p.display}`, `files: ${unmerged.join(", ")}`], ["resolve the conflicts, `git add` the files, then continue", ...conflictHint(ctx, run, p, unmerged)]);
  }
  stage(ctx, "merge", "done");
  return null;
}
