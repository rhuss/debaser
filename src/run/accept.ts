import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { AcceptanceCheck } from "../core/patchlist";
import type { AcceptanceResult, Planned, RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import * as git from "../git/git";
import { snapshot } from "../git/snapshot";
import { invoke, since } from "../harness/invoke";
import { fill, template } from "../harness/prompts";
import { harnessFor } from "../harness/select";
import { acceptFix, discard, judge, outcome } from "../harness/verify";
import { onInterrupt } from "../git/git";
import { slug } from "../plugins/sources/parse";
import { stepEnv } from "../report/manifest";
import { expand } from "../steps/commands";
import { endItem, event, excluded, save, signal, stage, startItem, stepVars } from "./common";
import { activity, harnessEnd, recordUse } from "./harness-common";
import { boundReached, commitAgentFix } from "./harness-fix";
import { stop } from "./stop";

export type AcceptanceRun = { result: "pass" | "fail"; log: string; exit: number; matched: boolean | null };

/** Runs one acceptance check (FR-028): from the tree root, with
 * `DEBASER_ARTIFACT` set to the build output (unset without an artifact).
 * Pass = the expected exit code and, with `match`, the pattern found in the
 * combined output. A check past its timeout (default 300 s) fails. */
export async function runAcceptance(
  ctx: Context,
  patch: Planned,
  check: AcceptanceCheck,
  env: Record<string, string | undefined>,
  log: string,
): Promise<AcceptanceRun> {
  const cmd = expand(check.run, stepVars(ctx, ctx.repo)),
    timeout = check.timeout ?? 300,
    expected = check.exit ?? 0;
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, `$ ${cmd.join(" ")}\n`);
  let child;
  try {
    child = Bun.spawn(cmd, { cwd: ctx.repo, env, stdout: "pipe", stderr: "pipe", stdin: "ignore", detached: true });
  } catch (error) {
    appendFileSync(log, `${(error as Error).message}\n`);
    return { result: "fail", log, exit: -1, matched: null };
  }
  const killGroup = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  };
  const forget = onInterrupt(killGroup);
  let output = "",
    timedOut = false;
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    // One decoder per stream: a character split across chunks stays whole.
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      appendFileSync(log, chunk);
      output += decoder.decode(chunk, { stream: true });
      ctx.echo(chunk);
    }
  };
  const pumps = Promise.all([pump(child.stdout), pump(child.stderr)]).catch(() => {});
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, timeout * 1000);
  const exit = await child.exited;
  clearTimeout(timer);
  if (timedOut) killGroup();
  await Promise.race([pumps, Bun.sleep(timedOut ? 200 : 2000)]);
  forget();
  const matched = check.match === undefined ? null : new RegExp(check.match, "m").test(output);
  appendFileSync(
    log,
    timedOut
      ? `\n(killed after ${timeout}s: the check timed out)\n`
      : `\n(exit ${exit}, expected ${expected}${matched === null ? "" : `; pattern ${matched ? "found" : "not found"}: ${check.match}`})\n`,
  );
  const pass = !timedOut && exit === expected && matched !== false;
  return { result: pass ? "pass" : "fail", log, exit, matched };
}

/** The acceptance phase (FR-028 to FR-030), between verify and finish: every
 * live patch's check runs (one flaky rerun each) before results count. null
 * when all passed, "again" after an accepted harness fix (the run goes back to
 * verify from the first step), an outcome for a stop (exit 6, or 5 for the harness). */
export async function acceptLoop(ctx: Context, run: RunState): Promise<Outcome | "again" | null> {
  const merged = run.plan.filter(p => !p.skip && p.merge);
  stage(ctx, "accept", "start");
  const fixedBefore = new Set(run.fixes.filter(f => f.acceptance && f.by === "agent").map(f => f.acceptance!));
  // Results are those of this pass; a later pass after a fix replaces them.
  run.acceptance = [];
  const env: Record<string, string | undefined> = { ...stepEnv(ctx, run, ctx.repo) },
    output = recipeOf(ctx).artifact?.output;
  if (output) env.DEBASER_ARTIFACT = join(ctx.repo, output);
  else delete env.DEBASER_ARTIFACT;
  const failing: { p: Planned; log: string }[] = [];
  for (const p of merged) {
    if (!p.acceptance) {
      run.acceptance.push({ patch: p.display, result: "unverified" });
      continue;
    }
    ctx.progress(`running the acceptance check of ${p.display}`);
    startItem(ctx, run, `accept:${p.display}`);
    signal(ctx, { t: "item", stage: "accept", id: p.display, state: "start" });
    const log = join(run.reportDir, "acceptance", `${slug(p.display)}.log`);
    let tried = await runAcceptance(ctx, p, p.acceptance, env, log),
      flaky = false;
    if (tried.result === "fail") {
      const keep = join(run.reportDir, "acceptance", `${slug(p.display)}-flaky.log`);
      writeFileSync(keep, readFileSync(log));
      ctx.progress(`the acceptance check of ${p.display} failed; running it once more in case it is flaky`);
      signal(ctx, { t: "retry", stage: "accept", id: p.display, why: "flaky", detail: "failed once" });
      tried = await runAcceptance(ctx, p, p.acceptance, env, log);
      flaky = tried.result === "pass";
      if (flaky) event(run, "flaky", { patch: p.display, detail: keep });
    }
    endItem(ctx, run, `accept:${p.display}`);
    const result: AcceptanceResult["result"] =
      tried.result === "fail" ? "fail" : flaky ? "flaky" : fixedBefore.has(p.display) ? "fixed" : "pass";
    run.acceptance.push({ patch: p.display, result, log, exit: tried.exit });
    if (tried.result === "pass" && run.acceptAttempts) delete run.acceptAttempts[p.display];
    signal(ctx, { t: "item", stage: "accept", id: p.display, state: tried.result === "fail" ? "failed" : "done", outcome: result });
    if (tried.result === "fail") failing.push({ p, log });
    save(ctx, run);
  }
  if (!failing.length) {
    stage(ctx, "accept", "done");
    return null;
  }
  // The first failing check goes to the acceptance harness, scoped to its patch.
  const { p, log } = failing[0],
    h = harnessFor(ctx, "acceptance"),
    names = failing.map(f => f.p.display).join(", ");
  run.acceptCursor = run.plan.indexOf(p);
  const failure = { step: "acceptance", command: p.acceptance!.run.join(" "), log, acceptance: p.display };
  if (h) {
    if (boundReached(ctx, run, h)) {
      const n = run.fixes.filter(f => f.by === "agent").length;
      return stop(ctx, run, 5, [`the acceptance check of ${p.display} fails again after the harness's ${n} fixes`, `log: ${log}`], ["fix it in the working tree (or commit the fix), then continue"], failure);
    }
    const { repo } = ctx,
      limit = h.attempts,
      tries = (run.acceptAttempts ??= {});
    // The tries count per check until it passes: a fix that leaves it failing uses one up.
    run.attempts = tries[p.display] ?? 0;
    let broken: { reason: string; log: string } | null = null;
    while (run.attempts < limit) {
      run.attempts++;
      tries[p.display] = run.attempts;
      run.calls++;
      save(ctx, run);
      const head = git.head(repo),
        before = snapshot(repo),
        recipe = recipeOf(ctx),
        text = fill(template("acceptance", recipe.prompts), {
          project: recipe.projectName,
          patch: p.display,
          description: p.description,
          prLink: p.prLink,
          command: p.acceptance!.run.join(" "),
          expected: `exit ${p.acceptance!.exit ?? 0}${p.acceptance!.match ? `, output matching /${p.acceptance!.match}/` : ""}`,
          artifact: env.DEBASER_ARTIFACT ?? "none (the check runs against the tree)",
          attempt: `${run.attempts} of ${limit}`,
          logExcerpt: readFileSync(log, "utf8").split("\n").slice(-200).join("\n"),
        });
      run.harnessCall = { kind: "acceptance", patch: p.display, step: "acceptance", attempt: run.attempts, head, snapshot: before, log };
      save(ctx, run);
      ctx.progress(`asking the harness to fix the acceptance check of ${p.display} (attempt ${run.attempts} of ${limit})`);
      const live = { stage: "accept" as const, id: p.display, attempt: run.attempts, limit };
      signal(ctx, { t: "harness", state: "start", ...live });
      const started = performance.now(),
        call = await invoke(h, "acceptance", text, {
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
      recordUse(ctx, run, { call: run.calls, kind: "acceptance", patch: p.display, attempt: run.attempts, ...outcome(verdict), seconds: since(started), usage: call.usage });
      if (verdict.ok) {
        commitAgentFix(ctx, run, "acceptance", verdict.files, log, p.display);
        stage(ctx, "accept", "done", "fixed; checking everything again");
        return "again";
      }
      ctx.progress(`rejected the harness's fix: ${verdict.reason}`);
      if (call.timedOut || verdict.broken) discard(repo, head, before, excluded(ctx));
      run.harnessCall = null;
      save(ctx, run);
      if (verdict.broken) {
        broken = { reason: verdict.reason, log: call.log };
        break;
      }
    }
    return stop(
      ctx,
      run,
      5,
      [
        broken
          ? `the harness failed to run on the acceptance check of ${p.display}: ${broken.reason}`
          : `the harness could not fix the acceptance check of ${p.display} in ${run.attempts} attempts`,
        `failing acceptance checks: ${names}`,
        `log: ${log}`,
        ...(broken ? [`harness log: ${broken.log}`] : []),
      ],
      ["fix it in the working tree (or commit the fix), then continue"],
      failure,
    );
  }
  return stop(
    ctx,
    run,
    6,
    [`the acceptance check of ${p.display} fails`, `failing acceptance checks: ${names}`, `command: ${failure.command}`, `log: ${log}`],
    ["fix it in the working tree (or commit the fix), then continue"],
    failure,
  );
}
