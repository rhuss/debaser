import { join } from "node:path";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { HarnessCall, RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import { acceptConflict, acceptFix } from "../harness/verify";
import { excluded, signal } from "./common";
import { commitAgentMerge } from "./harness-merge";
import { commitAgentFix } from "./harness-fix";
import { stop } from "./stop";
import { stepCommand } from "./verifyloop";

/** A run interrupted during a harness call: what the harness left is checked
 * like a finished result (T057). Accepted, it is committed as the agent's;
 * rejected, the run stops with the conflict or failing step in place. */
export async function resumeHarnessCall(ctx: Context, run: RunState, call: HarnessCall): Promise<Outcome | null> {
  const { repo } = ctx;
  ctx.progress(`checking what the interrupted harness call (attempt ${call.attempt}) left`);
  if (call.kind === "conflict") {
    const p = run.plan[run.cursor],
      files = call.files ?? [],
      verdict = acceptConflict(repo, { files, head: call.head, snapshot: call.snapshot }, excluded(ctx));
    if (verdict.ok) {
      commitAgentMerge(ctx, run, p);
      return null;
    }
    run.harnessCall = null;
    const what = `the interrupted harness resolution of ${p.display} was rejected: ${verdict.reason}`;
    signal(ctx, { t: "item", stage: "merge", id: p.display, state: "failed", outcome: "stopped", detail: what });
    return stop(ctx, run, 2, [what, `files: ${files.join(", ")}`], ["resolve the conflicts yourself, `git add` the files, then continue"]);
  }
  const step = call.step ?? run.step!,
    verdict = acceptFix(repo, { head: call.head, snapshot: call.snapshot }, excluded(ctx));
  if (verdict.ok) {
    commitAgentFix(ctx, run, step, verdict.files, call.log ?? "", call.kind === "acceptance" ? call.patch : undefined);
    return null;
  }
  run.harnessCall = null;
  const what = `the interrupted harness fix for ${call.kind === "acceptance" ? `the acceptance check of ${call.patch}` : step} was rejected: ${verdict.reason}`;
  signal(ctx, { t: "item", stage: "verify", id: step, state: "failed", outcome: "failed", detail: what });
  const s = recipeOf(ctx).steps.find(x => x.name === step);
  return stop(ctx, run, call.kind === "acceptance" ? 6 : 3, [what], ["fix it in the working tree (or commit the fix), then continue"], {
    step,
    command: s ? stepCommand(ctx, s).join(" ") : step,
    log: call.log ?? join(run.reportDir, "steps", `${step}.log`),
    ...(call.kind === "acceptance" && call.patch ? { acceptance: call.patch } : {}),
  });
}
