import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { Planned, RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { commitMerge, remerge } from "../git/merge";
import { snapshot } from "../git/snapshot";
import { invoke, since } from "../harness/invoke";
import { fill, template } from "../harness/prompts";
import { harnessFor } from "../harness/select";
import { acceptConflict, discard, judge, outcome } from "../harness/verify";
import { excluded, mergeMessage, save, signal, upstreamLine } from "./common";
import { activity, harnessEnd, recordUse, type Broken } from "./harness-common";
import { advance, resolved } from "./mergeloop";
import { conflictHint, stop } from "./stop";

/** Commits a harness resolution the checks accepted, and moves on (FR-019). */
export function commitAgentMerge(ctx: Context, run: RunState, p: Planned) {
  resolved(run, p, "harness");
  commitMerge(ctx.repo, `${mergeMessage(p)}\n\nResolved-By: harness`);
  run.harnessCall = null;
  advance(ctx, run, p, "agent-resolved");
}

/** Hands a conflict to the conflict harness: "resolved" when accepted, an
 * outcome for a stop (exit 5), null without a harness. */
export async function resolveConflict(ctx: Context, run: RunState, p: Planned, files: string[]): Promise<"resolved" | Outcome | null> {
  const h = harnessFor(ctx, "conflict");
  if (!h) return null;
  const { repo } = ctx,
    limit = h.attempts;
  let broken: Broken | null = null;
  while (run.attempts < limit) {
    run.attempts++;
    run.calls++;
    save(ctx, run);
    const head = git.head(repo),
      before = snapshot(repo),
      text = fill(template("conflict", recipeOf(ctx).prompts), {
        project: recipeOf(ctx).projectName,
        tree: ctx.repo,
        patch: p.display,
        description: p.description,
        prLink: p.prLink,
        prBody: p.prBody ?? "",
        files,
        upstream: upstreamLine(ctx, run),
        mergedSoFar: run.merged.map(m => `${m.source}: ${m.description}`),
      });
    run.harnessCall = { kind: "conflict", patch: p.display, attempt: run.attempts, head, snapshot: before, files };
    save(ctx, run);
    ctx.progress(`asking the harness to resolve ${p.display} (attempt ${run.attempts} of ${limit})`);
    const live = { stage: "merge" as const, id: p.display, attempt: run.attempts, limit };
    signal(ctx, { t: "harness", state: "start", ...live, files });
    const started = performance.now(),
      call = await invoke(h, "conflict", text, {
        cwd: repo,
        repo,
        reportDir: run.reportDir,
        number: run.calls,
        env: ctx.env,
        echo: ctx.echo,
        onActivity: activity(ctx, live),
      }),
      verdict = judge(call, h.timeoutSeconds, () => acceptConflict(repo, { files, head, snapshot: before }, excluded(ctx)));
    harnessEnd(ctx, live, call.usage, verdict);
    recordUse(ctx, run, { call: run.calls, kind: "conflict", patch: p.display, attempt: run.attempts, ...outcome(verdict), seconds: since(started), usage: call.usage });
    if (verdict.ok) {
      commitAgentMerge(ctx, run, p);
      return "resolved";
    }
    ctx.progress(`rejected the harness's resolution: ${verdict.reason}`);
    discard(repo, head, before, excluded(ctx));
    remerge(repo, p.commit!, mergeMessage(p), files);
    run.harnessCall = null;
    save(ctx, run);
    if (verdict.broken) {
      broken = { reason: verdict.reason, log: call.log };
      break;
    }
  }
  const what = broken
    ? `the harness failed to run on the conflict in ${p.display}: ${broken.reason}`
    : `the harness could not resolve the conflict in ${p.display} in ${run.attempts} attempts`;
  signal(ctx, { t: "item", stage: "merge", id: p.display, state: "failed", outcome: "stopped", detail: what });
  return stop(
    ctx,
    run,
    5,
    [what, `files: ${files.join(", ")}`, ...(broken ? [`harness log: ${broken.log}`] : [])],
    [
      broken ? "fix the harness, then continue to let it try again; or resolve the conflicts yourself, `git add` the files, then continue" : "resolve the conflicts yourself, `git add` the files, then continue",
      ...conflictHint(ctx, run, p, files),
    ],
  );
}
