import { join } from "node:path";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import { forStep } from "../plugins/parsers/registry";
import type { Step } from "../recipes/types";
import { writeManifest } from "../report/manifest";
import { expand } from "../steps/commands";
import { installNeeded } from "../steps/install";
import { runIsolated } from "../steps/isolated";
import { runStep, runWithRetry } from "../steps/run";
import { endItem, event, save, short, signal, startItem, stepVars } from "./common";
import * as harnessFix from "./harness-fix";
import { sendEstimate, stepLinks } from "./live";
import { stop, type StepFailure } from "./stop";

/** The commands a step runs in the checkout, with the tests to rerun when narrowed. */
export const stepCommand = (ctx: Context, step: Step, tests?: string[]) => expand(step.run, stepVars(ctx, ctx.repo, tests));
export const stepLog = (run: RunState, step: string) => join(run.reportDir, "steps", `${step}.log`);

/** Runs the recipe's steps in order on the merged tree (FR-008, FR-012): a
 * failure reruns once (flaky), then on plain upstream (exit 4 when it fails
 * there too); a step failing only on the patched tree goes to the check
 * harness, else stops with exit 3. A fix restarts from the first step. */
export async function verifyLoop(ctx: Context, run: RunState): Promise<Outcome | null> {
  const recipe = recipeOf(ctx),
    steps = recipe.steps;
  signal(ctx, { t: "stage", stage: "verify", state: "start", links: stepLinks(ctx, run) });
  const failed = (step: string, detail: string) =>
    signal(ctx, { t: "item", stage: "verify", id: step, state: "failed", outcome: "failed", detail });
  let env = { ...ctx.env, ...writeManifest(ctx, run, gitHead(ctx)) };
  for (let i = Math.max(0, steps.findIndex(s => s.name === run.step)); i < steps.length; i++) {
    const step = steps[i];
    if (i === 0) env = { ...ctx.env, ...writeManifest(ctx, run, gitHead(ctx)) };
    run.step = step.name;
    save(ctx, run);
    if (recipe.install?.step === step.name && !installNeeded(ctx.repo, recipe, run.startHead)) {
      event(run, "not-needed", { step: step.name });
      signal(ctx, { t: "item", stage: "verify", id: step.name, state: "skipped", outcome: "skipped", detail: "dependencies unchanged" });
      continue;
    }
    ctx.progress(`running ${step.name}`);
    const log = stepLog(run, step.name),
      parser = forStep(step.parser);
    startItem(ctx, run, `step:${step.name}`);
    signal(ctx, { t: "item", stage: "verify", id: step.name, state: "start" });
    // A flaky failure would otherwise cost an upstream run and an agent fix.
    const keep = join(run.reportDir, "steps", `${step.name}-flaky-${run.events.filter(e => e.kind === "flaky").length + 1}.log`),
      tried = await runWithRetry(stepCommand(ctx, step), {
        cwd: ctx.repo,
        log,
        env,
        echo: ctx.echo,
        timeout: step.timeout,
        keep,
        again: failedLog => {
          const narrowed = parser.parse(failedLog, ctx.repo).narrowedArgs;
          return narrowed?.length && step.run.includes("{tests}") ? stepCommand(ctx, step, narrowed) : null;
        },
        onRetry: () => {
          ctx.progress(`${step.name} failed; running what failed once more in case it is flaky`);
          signal(ctx, { t: "retry", stage: "verify", id: step.name, why: "flaky", detail: `${step.name} failed once` });
        },
      });
    endItem(ctx, run, `step:${step.name}`);
    if (tried.ok) {
      if (tried.flaky) event(run, "flaky", { step: step.name, detail: keep });
      event(run, "passed", { step: step.name });
      save(ctx, run);
      const fixed = run.fixes.some(f => f.step === step.name && f.by === "agent");
      signal(ctx, { t: "item", stage: "verify", id: step.name, state: "done", outcome: tried.flaky ? "flaky" : fixed ? "fixed" : "passed" });
      sendEstimate(ctx, run);
      continue;
    }
    ctx.progress(`${step.name} failed again; trying it on plain upstream`);
    signal(ctx, { t: "retry", stage: "verify", id: step.name, why: "upstream", detail: `${step.name} failed twice` });
    const alone = await runIsolated(ctx, run, "upstream", run.upstream.tip, [], step.name);
    const failure: StepFailure = { step: step.name, command: stepCommand(ctx, step).join(" "), log };
    if (alone !== "passed") {
      event(run, "upstream-broken", { step: step.name });
      save(ctx, run);
      failed(step.name, `fails on plain upstream ${short(run.upstream.tip)} too`);
      return stop(
        ctx,
        run,
        4,
        [`${step.name} fails on plain upstream ${short(run.upstream.tip)} too: upstream is broken`, `log: ${log}`],
        ["roll back, then rebuild once upstream is fixed"],
      );
    }
    const fix = await harnessFix.fixStep(ctx, run, step, failure);
    if (fix === "fixed") {
      // A fix can break a step that passed before it, so everything runs again.
      i = -1;
      continue;
    }
    if (fix) return fix;
    failed(step.name, "it passes on plain upstream: a patch breaks it");
    return stop(
      ctx,
      run,
      3,
      [`${step.name} failed`, `command: ${failure.command}`, `log: ${log}`],
      ["fix it in the working tree (or commit the fix), then continue"],
      failure,
    );
  }
  signal(ctx, { t: "stage", stage: "verify", state: "done" });
  return null;
}
const gitHead = (ctx: Context) => Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ctx.repo }).stdout.toString().trim();
export { runStep };
