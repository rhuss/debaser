import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { snapshot } from "../git/snapshot";
import { invoke, since } from "../harness/invoke";
import { fill, template } from "../harness/prompts";
import { harnessFor, type Harness } from "../harness/select";
import { acceptFix, discard, judge, outcome } from "../harness/verify";
import type { Step } from "../recipes/types";
import { stepEnv } from "../report/manifest";
import { runStep } from "../steps/run";
import { endItem, event, excluded, save, signal, startItem } from "./common";
import { activity, harnessEnd, recordUse, type Broken } from "./harness-common";
import { stop, summaryOf, type StepFailure } from "./stop";
import { stepCommand, stepLog } from "./verifyloop";
import { installNeeded } from "../steps/install";

/** Commits an accepted harness fix as its own commit (FR-020). */
export function commitAgentFix(ctx: Context, run: RunState, step: string, files: string[], log: string, acceptance?: string) {
  const { repo } = ctx;
  git.must(repo, ["add", "-A", "--", ...files]);
  git.must(repo, ["commit", "--no-verify", "-q", "-m", `debaser: fix ${acceptance ? `acceptance ${acceptance}` : step} (agent)\n\nFixed-By: harness`]);
  const sha = git.head(repo);
  run.fixes.push({ step, commit: sha, by: "agent", files, log, ...(acceptance ? { acceptance } : {}) });
  event(run, "agent-fix", { step, detail: sha, ...(acceptance ? { patch: acceptance } : {}) });
  run.harnessCall = null;
  save(ctx, run);
}
/** The total number of fixes the harness may make before the run stops
 * (FR-021): attempts × (steps + acceptance checks). */
export function fixBound(ctx: Context, run: RunState, h: Harness): number {
  const checks = run.plan.filter(p => !p.skip && p.acceptance).length;
  return h.attempts * (recipeOf(ctx).steps.length + checks);
}
/** Whether the fix bound is reached; agent fixes count, acceptance fixes included. */
export const boundReached = (ctx: Context, run: RunState, h: Harness) => run.fixes.filter(f => f.by === "agent").length >= fixBound(ctx, run, h);

/** Hands a step failing only on the patched tree to the check harness:
 * "fixed" when a fix was accepted and the step passes, an outcome for a stop
 * (exit 5), null without a harness. */
export async function fixStep(ctx: Context, run: RunState, step: Step, failure: StepFailure): Promise<"fixed" | Outcome | null> {
  const h = harnessFor(ctx, "check");
  if (!h) return null;
  // Fixes that keep breaking each other stop the run instead of looping.
  const boundStop = () => {
    const agentFixes = run.fixes.filter(f => f.by === "agent").length;
    signal(ctx, { t: "item", stage: "verify", id: step.name, state: "failed", outcome: "failed", detail: `fails again after the harness's ${agentFixes} fixes` });
    return stop(ctx, run, 5, [`${step.name} fails again after the harness's ${agentFixes} fixes`, `log: ${failure.log}`], ["fix it in the working tree (or commit the fix), then continue"], failure);
  };
  if (boundReached(ctx, run, h)) return boundStop();
  const fixed = await fixWithHarness(ctx, run, step, failure, h);
  if (fixed === true) return "fixed";
  // The bound can also end the attempts early: say so, not that they ran out.
  if (fixed === null && boundReached(ctx, run, h)) return boundStop();
  signal(ctx, {
    t: "item",
    stage: "verify",
    id: step.name,
    state: "failed",
    outcome: "failed",
    detail: fixed ? `the harness failed to run: ${fixed.reason}` : `the harness could not fix it in ${run.attempts} attempts`,
  });
  return stop(
    ctx,
    run,
    5,
    [
      fixed ? `the harness failed to run on ${step.name}: ${fixed.reason}` : `the harness could not fix ${step.name} in ${run.attempts} attempts`,
      `command: ${failure.command}`,
      `log: ${failure.log}`,
      ...(fixed ? [`harness log: ${fixed.log}`] : []),
    ],
    [fixed ? "fix the harness, then continue to let it try again; or fix the step yourself, then continue" : "fix it in the working tree (or commit the fix), then continue"],
    failure,
  );
}

/** Asks the harness to fix a failing step, committing each accepted change as
 * its own fix commit, until the step passes or the attempts run out. */
async function fixWithHarness(ctx: Context, run: RunState, step: Step, failure: StepFailure, h: Harness): Promise<true | Broken | null> {
  const { repo } = ctx,
    limit = h.attempts,
    recipe = recipeOf(ctx);
  run.attempts = 0;
  // The failure each fix answers: a fix that leaves the step failing hands the
  // next attempt a new failure, which the next fix is recorded against.
  const keepFailure = () => {
    const path = join(run.reportDir, "steps", `${step.name}-failed-${run.fixes.length + 1}.log`);
    copyFileSync(failure.log, path);
    return path;
  };
  let failedLog = keepFailure();
  while (run.attempts < limit) {
    // A fix that left the step failing still counts toward the total bound (FR-021).
    if (boundReached(ctx, run, h)) break;
    run.attempts++;
    run.calls++;
    save(ctx, run);
    const head = git.head(repo),
      before = snapshot(repo),
      text = fill(template("check", recipe.prompts), {
        project: recipe.projectName,
        step: step.name,
        command: failure.command,
        failing: summaryOf(ctx, { step: step.name, log: failure.log }) ?? "see the output below",
        cause: "a patch, or how the patches combine: it passes on plain upstream",
        attempt: `${run.attempts} of ${limit}`,
        patches: run.merged.map(m => `${m.source}: ${m.description}`),
        log: failure.log,
        logExcerpt: readFileSync(failure.log, "utf8").split("\n").slice(-200).join("\n"),
        finish: "When you are done, stop. Say briefly what was wrong and what you changed; debaser commits your change as a separate fix commit and runs every step again.",
      });
    run.harnessCall = { kind: "check", step: step.name, attempt: run.attempts, head, snapshot: before, log: failedLog };
    save(ctx, run);
    ctx.progress(`asking the harness to fix ${step.name} (attempt ${run.attempts} of ${limit})`);
    const live = { stage: "verify" as const, id: step.name, attempt: run.attempts, limit };
    signal(ctx, { t: "harness", state: "start", ...live });
    const started = performance.now(),
      call = await invoke(h, "check", text, {
        cwd: repo,
        repo,
        reportDir: run.reportDir,
        number: run.calls,
        env: ctx.env,
        echo: ctx.echo,
        onActivity: activity(ctx, live),
      }),
      verdict = judge(call, h.timeoutSeconds, () => acceptFix(repo, { head, snapshot: before }, excluded(ctx)));
    harnessEnd(ctx, live, call.usage, verdict);
    recordUse(ctx, run, { call: run.calls, kind: "check", step: step.name, attempt: run.attempts, ...outcome(verdict), seconds: since(started), usage: call.usage });
    if (!verdict.ok) {
      ctx.progress(`rejected the harness's fix: ${verdict.reason}`);
      if (call.timedOut || verdict.broken) discard(repo, head, before, excluded(ctx));
      run.harnessCall = null;
      save(ctx, run);
      if (verdict.broken) return { reason: verdict.reason, log: call.log };
      continue;
    }
    commitAgentFix(ctx, run, step.name, verdict.files, failedLog);
    // Every step reruns from the first after a fix (FR-020): the steps before
    // this one may build what it needs. One of them failing now goes back to
    // the verify loop, which starts over and handles it.
    if (!(await rerunEarlier(ctx, run, step))) return true;
    ctx.progress(`running ${step.name} again`);
    startItem(ctx, run, `step:${step.name}`);
    signal(ctx, { t: "item", stage: "verify", id: step.name, state: "start" });
    const passed = await runStep(stepCommand(ctx, step), {
      cwd: repo,
      log: failure.log,
      env: stepEnv(ctx, run, repo),
      echo: ctx.echo,
      timeout: step.timeout,
    });
    endItem(ctx, run, `step:${step.name}`);
    if (passed) {
      event(run, "passed", { step: step.name });
      save(ctx, run);
      signal(ctx, { t: "item", stage: "verify", id: step.name, state: "done", outcome: "fixed" });
      return true;
    }
    if (run.attempts < limit) failedLog = keepFailure();
  }
  return null;
}

/** Runs the steps before `step` again in the checkout after a fix (the
 * install step only when needed); false when one of them fails. */
async function rerunEarlier(ctx: Context, run: RunState, step: Step): Promise<boolean> {
  const recipe = recipeOf(ctx),
    earlier = recipe.steps.slice(0, Math.max(0, recipe.steps.findIndex(s => s.name === step.name)));
  for (const s of earlier) {
    if (recipe.install?.step === s.name && !installNeeded(ctx.repo, recipe, run.startHead)) continue;
    ctx.progress(`running ${s.name} again before ${step.name}`);
    startItem(ctx, run, `step:${s.name}`);
    const ok = await runStep(stepCommand(ctx, s), { cwd: ctx.repo, log: stepLog(run, s.name), env: stepEnv(ctx, run, ctx.repo), echo: ctx.echo, timeout: s.timeout });
    endItem(ctx, run, `step:${s.name}`);
    if (!ok) return false;
  }
  return true;
}
