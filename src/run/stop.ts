import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Context } from "../core/context";
import { listOf, recipeOf } from "../core/context";
import type { Code } from "../core/errors";
import type { Attribution, Planned, RunState, StopFailure as Stopped } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { snapshot } from "../git/snapshot";
import { fill, template } from "../harness/prompts";
import { forStep } from "../plugins/parsers/registry";
import { attribute } from "../steps/attribute";
import { word } from "../steps/commands";
import { writeReport } from "../report/report";
import { mergedPatches, save, signal, upstreamLine } from "./common";
import { endRun } from "./end";

/** A failing step a run stops at: what it ran and its output. `acceptance`
 * names the patch whose acceptance check it is. */
export type StepFailure = { step: string; command: string; log: string; acceptance?: string };

/** Stops the run with `code` (FR-014): the reason, the implicated patches, the
 * log, a ready-to-run agent prompt, and `continue` and `rollback`. */
export async function stop(
  ctx: Context,
  run: RunState,
  code: Code,
  what: string[],
  next: string[],
  failure?: StepFailure,
): Promise<Outcome> {
  run.stopped = { code, snapshot: snapshot(ctx.repo) };
  run.stopFailure = failure ? await blame(ctx, run, failure) : null;
  save(ctx, run);
  const why = run.stopFailure && cause(run.stopFailure.attribution),
    failing = run.stopFailure ? summaryOf(ctx, run.stopFailure) : null,
    reason = [what[0], ...(failing ? [`failing: ${failing}`] : []), ...(why ? [`caused by: ${why}`] : []), ...what.slice(1)],
    handoffs = await writeReport(ctx, run, code, reason),
    agent = failure && run.stopFailure && !failure.acceptance ? agentHint(ctx, run, failure, run.stopFailure, why) : [];
  return endRun(ctx, run, {
    code,
    lines: [
      `debaser stopped: ${reason[0]}`,
      ...reason.slice(1).map(line => `  ${line}`),
      // Where to fix it: the build directory, not the checkout debaser was started from (FR-011).
      `  build directory: ${ctx.repo}`,
      `  report: ${join(run.reportDir, "report.md")}`,
      ...handoffs.map(path => `  handoff: ${path}`),
      ...next.map(line => `  ${line}`),
      ...agent.map(line => `  ${line}`),
      // Upstream breakage isn't fixed by continuing the pinned run.
      ...(code === 4 ? [] : ["  continue: debaser continue"]),
      "  undo the run: debaser rollback",
    ],
  });
}

/** The failing output in a few words, from the step's parser; null when it says nothing. */
export function summaryOf(ctx: Context, f: { step: string; log: string }): string | null {
  if (!existsSync(f.log)) return null;
  const step = recipeOf(ctx).steps.find(s => s.name === f.step);
  return forStep(step?.parser).parse(readFileSync(f.log, "utf8"), ctx.repo).summary || null;
}

/** The patches a failing step points at, worked out once per step and tree:
 * a stop that comes back to the same failure doesn't run them again. */
async function blame(ctx: Context, run: RunState, f: StepFailure): Promise<Stopped> {
  const head = git.head(ctx.repo),
    known = run.stopFailure;
  if (known?.step === f.step && known.head === head && known.acceptance === f.acceptance) return known;
  // The step's log is written again by the next run; keep the failure this stop answers.
  const log = join(run.reportDir, "steps", `${f.step}-failed-${run.fixes.length + 1}.log`);
  if (existsSync(f.log) && resolve(f.log) !== resolve(log)) copyFileSync(f.log, log);
  if (f.acceptance)
    return { step: f.step, acceptance: f.acceptance, head, log, attribution: [{ kind: "build-drift", patch: f.acceptance, others: [] }] };
  ctx.progress(`working out which patches ${f.step} fails on`);
  const attribution = await attribute(ctx, run, { step: f.step, merged: mergedPatches(run), fixFiles: [], log });
  return { step: f.step, head, log, attribution };
}
/** The patches a failure points at, in a few words; null when none does. */
export function cause(attribution: Attribution[]): string | null {
  const drift = attribution.filter(a => a.kind === "build-drift").map(a => a.patch);
  if (drift.length) return `${drift.join(", ")} ${drift.length > 1 ? "fail" : "fails"} alone on upstream`;
  if (attribution.length > 1) return `${attribution.map(a => a.patch).join(" and ")} only together`;
  if (attribution.length) return `${attribution[0].patch} together with the other patches`;
  return null;
}
/** Writes a prompt for fixing the failing step with an agent; returns the
 * lines that name it and the command that runs it in the checkout. */
function agentHint(ctx: Context, run: RunState, f: StepFailure, stopped: Stopped, why: string | null): string[] {
  const path = join(run.reportDir, `fix-${f.step}.md`),
    excerpt = existsSync(stopped.log) ? readFileSync(stopped.log, "utf8").split("\n").slice(-200).join("\n") : "";
  writeFileSync(
    path,
    fill(template("check", recipeOf(ctx).prompts), {
      project: recipeOf(ctx).projectName,
      tree: ctx.repo,
      step: f.step,
      command: f.command,
      failing: summaryOf(ctx, stopped) ?? "see the output below",
      cause: why ?? "not worked out: no merged patch touches the files the failure names",
      attempt: "by hand, after the run stopped",
      patches: run.merged.map(m => `${m.source}: ${m.description}`),
      log: stopped.log,
      logExcerpt: excerpt,
      finish:
        `You are working in the build directory ${ctx.repo}. ` +
        "Do not run debaser yourself. When the command passes, stop and say briefly what was wrong and what you changed; the user then runs `debaser continue`, which commits the fix and verifies the build again.",
    }),
  );
  return [`prompt for an agent: ${path}`, `run it: cd ${word(ctx.repo)} && ${agentCommand(ctx, path)}`];
}
/** Writes a prompt for resolving the conflict a run stopped at with an agent
 * (FR-014); returns the lines that name it and the command that runs it. */
export function conflictHint(ctx: Context, run: RunState, p: Planned, files: string[]): string[] {
  const path = join(run.reportDir, "fix-conflict.md");
  mkdirSync(run.reportDir, { recursive: true });
  writeFileSync(
    path,
    fill(template("conflict", recipeOf(ctx).prompts), {
      project: recipeOf(ctx).projectName,
      tree: ctx.repo,
      patch: p.display,
      description: p.description,
      prLink: p.prLink,
      prBody: p.prBody ?? "",
      files,
      upstream: upstreamLine(ctx, run),
      mergedSoFar: run.merged.map(m => `${m.source}: ${m.description}`),
    }) + `\nYou are working in the build directory ${ctx.repo}. The run stopped at this conflict: do not run debaser yourself. The user stages your resolution and runs \`debaser continue\`.\n`,
  );
  return [`prompt for an agent: ${path}`, `run it: cd ${word(ctx.repo)} && ${agentCommand(ctx, path)}`];
}
/** The command that runs the configured harness (or claude) on the prompt at `path`. */
function agentCommand(ctx: Context, path: string): string {
  const h = listOf(ctx).harness,
    exe = !h?.command[0] ? "claude" : h.command[0].includes("/") ? resolve(ctx.repo, h.command[0]) : h.command[0],
    // The command debaser itself would run: the whole harness command, its
    // {prompt_file} named in it; a program without one reads the prompt from
    // stdin, and a bare program takes it as its argument.
    args = h ? [exe, ...h.command.slice(1)] : null,
    full = (args ?? []).map(arg => arg.replaceAll("{prompt_file}", path)),
    named = full.some((arg, i) => args![i] !== arg);
  return h ? (named ? full.map(word).join(" ") : `${full.map(word).join(" ")} < ${word(path)}`) : `${word(exe)} "$(cat ${word(path)})"`;
}
