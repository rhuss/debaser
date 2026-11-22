import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../core/context";
import { listOf } from "../core/context";
import { Explained } from "../core/errors";
import * as runstate from "../core/runstate";
import type { RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { commitMerge, mergeInProgress, unmergedFiles } from "../git/merge";
import { changedSince } from "../git/snapshot";
import { loadRecipe } from "../recipes/load";
import * as timings from "../timings/timings";
import { event, excluded, mergeMessage, ms, save, short, signal } from "./common";
import { endRun } from "./end";
import { advance, resolved } from "./mergeloop";
import { proceed } from "./build";
import { rollback } from "./rollback";
import * as harnessResume from "./harness-resume";
import { resolveConflict } from "./harness-merge";
import { harnessFor } from "../harness/select";
import * as rebasePhase from "./rebase-phase";
import * as live from "./live";

import { buildLeftover } from "./leftover";

/** Resumes a stopped run once the user resolved the conflict or fixed the step (FR-015). */
export async function resume(ctx: Context, o: { skipBranch?: boolean } = {}): Promise<Outcome> {
  const { repo } = ctx,
    list = listOf(ctx),
    run = runstate.loadRun(ctx.dir);
  if (!run) throw new Explained("there is no stopped run to continue");
  if (o.skipBranch && (run.kind !== "rebase" || !run.rebaseStop))
    throw new Explained("--skip-branch only goes with a rebase run stopped at a branch");
  if (run.phase === "rollback") return rollback(ctx);
  // The time the run sat stopped isn't its time: counting starts again here.
  timings.resume(run, ms(ctx));
  if (run.kind === "rebase") return rebasePhase.resumeRebase(ctx, run, !!o.skipBranch);
  loadRecipe(ctx, run.upstream.tip);
  live.replay(ctx, run, "continue");
  // Merging or committing onto any other branch would change a branch the run doesn't own.
  if (git.currentBranch(repo) !== list.branch || !git.isAncestor(repo, run.upstream.tip, "HEAD"))
    throw new Explained(
      `${list.branch} is not checked out at this run's upstream ${short(run.upstream.tip)}; check it out to continue, or undo the run with \`debaser rollback\``,
    );
  if (run.harnessCall) {
    const outcome = await harnessResume.resumeHarnessCall(ctx, run, run.harnessCall);
    if (outcome) return outcome;
  } else if (run.phase === "merge") {
    const p = run.plan[run.cursor];
    if (mergeInProgress(repo)) {
      const left = unmergedFiles(repo);
      // A run stopped because the conflict harness kept failing asks it again (US3-5).
      if (left.length && run.stopped?.code === 5 && harnessFor(ctx, "conflict")) {
        run.attempts = 0;
        run.stopped = null;
        const handled = await resolveConflict(ctx, run, p, left);
        if (handled !== "resolved" && handled) return handled;
        if (handled === "resolved") {
          save(ctx, run);
          return proceed(ctx, run);
        }
      }
      if (left.length) {
        signal(ctx, { t: "item", stage: "merge", id: p.display, state: "failed", outcome: "stopped", detail: `unmerged files: ${left.join(", ")}` });
        return endRun(ctx, run, {
          code: 2,
          lines: [`debaser: ${p.display} still has unmerged files: ${left.join(", ")}`, "  resolve them and `git add` them, then continue"],
        });
      }
      commitMerge(repo, mergeMessage(p));
      resolved(run, p, "user");
      advance(ctx, run, p, "user-resolved");
    } else if (p && git.revParse(repo, "HEAD^2") === p.commit) {
      resolved(run, p, "user");
      advance(ctx, run, p, "user-resolved");
    }
  } else if ((run.phase === "verify" || run.phase === "accept") && (run.step || run.stopFailure)) {
    commitUserFix(ctx, run);
  }
  // An acceptance check whose harness ran out of attempts gets a fresh set on
  // continue, as conflicts and steps do (US3-5).
  const stoppedCheck = run.stopFailure?.acceptance;
  if (run.stopped?.code === 5 && stoppedCheck && run.acceptAttempts) delete run.acceptAttempts[stoppedCheck];
  // A fix may break a step that passed before it: verify from the first step again.
  if (run.phase === "verify" || run.phase === "accept") {
    run.phase = "verify";
    run.step = null;
  }
  run.stopped = null;
  save(ctx, run);
  return proceed(ctx, run);
}

/** Commits what the user changed since the stop as their fix; without a stop
 * (an interrupted run), only tracked changes count. */
function commitUserFix(ctx: Context, run: RunState) {
  const { repo } = ctx,
    known = run.stopFailure && (run.stopFailure.acceptance || run.stopFailure.step === run.step) ? run.stopFailure : null,
    step = known?.step ?? run.step!,
    changed = (
      run.stopped
        ? changedSince(repo, run.stopped.snapshot, excluded(ctx))
        : git.must(repo, ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean)
    )
      .filter(path => !buildLeftover(path))
      .filter(path => existsSync(join(repo, path)) || git.git(repo, ["cat-file", "-e", `HEAD:${path}`]).code === 0),
    // A fix the user committed before `continue` leaves the tree clean: the
    // commits since the stop are theirs too, and answer what it stopped on.
    committed =
      known && run.stopped && git.revParse(repo, "HEAD") !== known.head
        ? git
            .must(repo, ["diff", "--name-only", known.head, "HEAD"])
            .split("\n")
            .filter(Boolean)
            .filter(path => !buildLeftover(path))
        : [];
  if (changed.length) {
    git.must(repo, ["add", "-A", "--", ...changed]);
    git.must(repo, ["commit", "--no-verify", "-q", "-m", known?.acceptance ? `debaser: fix acceptance ${known.acceptance} (user)` : `debaser: fix ${step} (user)`]);
  }
  const files = [...new Set([...changed, ...committed])];
  if (files.length) {
    run.fixes.push({
      step,
      commit: git.head(repo),
      by: "user",
      files,
      ...(known ? { log: known.log, attribution: known.attribution } : {}),
      ...(known?.acceptance ? { acceptance: known.acceptance } : {}),
    });
    event(run, "user-fix", { step });
  }
}
