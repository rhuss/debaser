import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Context } from "../core/context";
import { listOf, recipeOf } from "../core/context";
import type { Code } from "../core/errors";
import { paths } from "../core/paths";
import type { HarnessUse, RunState } from "../core/runstate";
import * as git from "../git/git";
import { filesTouchedByMerge, mergeTreeCheck } from "../git/merge";
import { display, sourceKey } from "../plugins/sources/parse";
import type { Source } from "../plugins/sources/types";
import { attribute } from "../steps/attribute";
import { mergedPatches, save, short } from "../run/common";
import { writeHandoffs, type MergeCheck } from "./handoff";
import { lines as rebaseLines } from "../rebase/rebase";

const section = (title: string, lines: string[], empty = "none") => [`## ${title}`, "", ...(lines.length ? lines : [empty]), ""];

/** Clash notes (FR-026): conflicts during the run on patches that are clean
 * against upstream alone, naming the patches merged before it that touch the
 * same files. */
export function clashes(repo: string, run: RunState, check: MergeCheck[]): string[] {
  return run.conflicts
    .filter(c => check.find(r => r.display === c.patch)?.clean === true)
    .map(c => {
      const at = run.plan.findIndex(p => p.display === c.patch),
        others = run.plan
          .slice(0, Math.max(0, at))
          .filter(p => p.merge && filesTouchedByMerge(repo, p.merge).some(f => c.files.includes(f)))
          .map(p => p.display);
      return (
        `- ${c.patch} conflicted with ${others.length ? others.join(", ") : "patches merged before it"} in ${c.files.join(", ") || "some files"}` +
        ` (resolved by ${c.by ?? "nobody yet"}); it merges cleanly onto upstream alone`
      );
    });
}
/** A token count: `51.0k` from 1000 on, the plain number below. */
export function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
const inOut = (u: { input: number; output: number }) => `${tokens(u.input)} in / ${tokens(u.output)} out`;
const kindWord: Record<HarnessUse["kind"], string> = {
  conflict: "conflict",
  check: "fix",
  acceptance: "acceptance fix",
  "rebase-conflict": "rebase conflict",
  "rebase-check": "rebased-branch fix",
};
/** The harness calls: a totals line, then one line per call. */
export function harnessLines(uses: HarnessUse[]): string[] {
  const known = uses.flatMap(u => (u.usage ? [u.usage] : [])),
    unknown = uses.length - known.length,
    total = known.reduce((sum, u) => ({ input: sum.input + u.input, output: sum.output + u.output }), { input: 0, output: 0 }),
    accepted = uses.filter(u => u.ok).length,
    totals = !known.length ? "tokens unknown" : `tokens ${inOut(total)}${unknown ? ` (${unknown} ${unknown === 1 ? "call" : "calls"} unknown)` : ""}`;
  return [
    `- ${uses.length} ${uses.length === 1 ? "call" : "calls"}, ${accepted} accepted, ${totals}`,
    ...uses.map(u => {
      const what =
        u.kind === "check" ? u.step : u.kind === "rebase-conflict" ? u.branch : u.kind === "rebase-check" ? `${u.branch} ${u.step}` : u.patch;
      return `- ${what} ${kindWord[u.kind]} try ${u.attempt}: ${u.ok ? "accepted" : `rejected: ${u.reason}`}, ${u.usage ? inOut(u.usage) : "tokens unknown"}`;
    }),
  ];
}
export function harnessTotals(uses: HarnessUse[]): { calls: number; tokens: { input: number; output: number } | null } {
  const known = uses.flatMap(u => (u.usage ? [u.usage] : []));
  return {
    calls: uses.length,
    tokens: known.length ? known.reduce((s, u) => ({ input: s.input + u.input, output: s.output + u.output }), { input: 0, output: 0 }) : null,
  };
}

type StepResult = "pass" | "flaky" | "fixed" | "fail" | "skipped" | "not run" | "upstream-broken";
const stepWords: Record<StepResult, string> = {
  pass: "passed",
  flaky: "passed",
  fixed: "passed after a fix",
  fail: "failed",
  skipped: "not needed",
  "not run": "not run",
  "upstream-broken": "fails on plain upstream too",
};
/** Each recipe step's result in this run. */
export function stepResults(ctx: Context, run: RunState, code: number): { name: string; result: StepResult; log: string }[] {
  return recipeOf(ctx).steps.map(s => {
    const events = run.events.filter(e => e.step === s.name && !e.patch),
      last = events.at(-1)?.kind,
      log = join(run.reportDir, "steps", `${s.name}.log`);
    let result: StepResult;
    if (last === "upstream-broken") result = "upstream-broken";
    else if (run.step === s.name && code !== 0 && run.phase === "verify") result = "fail";
    else if (last === "passed")
      result = run.fixes.some(f => f.step === s.name && !f.acceptance) ? "fixed" : events.some(e => e.kind === "flaky") ? "flaky" : "pass";
    else if (last === "not-needed") result = "skipped";
    else result = "not run";
    return { name: s.name, result, log };
  });
}

/** Writes `report.md` and `result.json` into the run's directory, the handoffs
 * beside them, points `latest` at it and prunes old runs; returns the handoff paths. */
export async function writeReport(
  ctx: Context,
  run: RunState,
  code: Code,
  reason: string[],
  extra: { artifact?: { installed: string | null; previous: string | null } } = {},
): Promise<string[]> {
  const { repo } = ctx,
    active = run.plan.filter(p => !p.skip),
    // The commits this run built, not the refs: a patch branch may have moved on during a stop.
    mergeCheck: MergeCheck[] = active.map(p => {
      if (!p.commit || !git.revParse(repo, p.commit)) return { display: p.display, clean: null, files: [] };
      const c = mergeTreeCheck(repo, run.upstream.tip, p.commit);
      return { display: p.display, clean: c.clean, files: c.files };
    }),
    pulled = run.startTip
      ? git
          .must(repo, ["log", "--no-merges", "--format=%H %s", `${run.startTip}..${run.upstream.tip}`])
          .split("\n")
          .filter(Boolean)
          .map(line => ({ sha: line.slice(0, 40), subject: line.slice(41) }))
      : [];
  for (const fix of run.fixes)
    if (fix.by === "agent" && !fix.attribution && !fix.acceptance) {
      ctx.progress(`working out which patches the ${fix.step} fix answered`);
      fix.attribution = await attribute(ctx, run, { step: fix.step, merged: mergedPatches(run), fixFiles: fix.files, log: fix.log ?? "" });
      save(ctx, run);
    }
  const handoffs = run.kind === "rebase" || run.reportDir ? writeHandoffs(ctx, run, mergeCheck) : [];
  mkdirSync(run.reportDir, { recursive: true });
  writeFileSync(join(run.reportDir, "report.md"), reportText(ctx, run, { code, reason, pulled, mergeCheck, handoffs }));
  writeFileSync(join(run.reportDir, "result.json"), JSON.stringify(result(ctx, run, { code, pulled, mergeCheck, handoffs, ...extra }), null, 2) + "\n");
  const reports = paths.reports(ctx.dir);
  linkLatest(reports, run.reportDir);
  prune(reports);
  return handoffs;
}

/** The run's outcome word, shared by report.md's result line and result.json:
 * exit 1 after a finished run (a failed push) is "failed". */
const outcomeOf = (code: number) => (code === 0 ? "success" : code === 1 ? "failed" : "stopped");

function reportText(
  ctx: Context,
  run: RunState,
  r: { code: number; reason: string[]; pulled: { sha: string; subject: string }[]; mergeCheck: MergeCheck[]; handoffs: string[] },
): string {
  const of = (kind: string) => run.events.filter(e => e.kind === kind),
    recipe = recipeOf(ctx),
    built = recipe.artifact?.install ?? listOf(ctx).branch,
    notDone = `Result: ${outcomeOf(r.code)} (exit ${r.code}): ${r.reason.join("; ")}`,
    rebased = run.rebased
      ? section("Rebased branches", rebaseLines(run.rebased, { current: true }).map(line => `- ${line}`), "no own branch needed a rebase")
      : [],
    harness = run.harnessUsage?.length ? section("Harness", harnessLines(run.harnessUsage)) : [],
    handoffs = section("Handoffs", r.handoffs.map(path => `- ${join("handoffs", basename(path))}`));
  if (run.kind === "rebase")
    return [
      `# debaser rebase report, ${run.startedAt}`,
      "",
      r.code === 0 ? `Result: rebased own branches onto upstream ${short(run.upstream.tip)}.` : notDone,
      "",
      ...rebased,
      ...harness,
      ...section("Notes", of("rebase-note").map(e => `- ${e.detail}`)),
      ...handoffs,
    ].join("\n");
  const merged = run.merged.map(p => {
    const how = run.events.find(e => e.patch === p.source && !["note", "warning", "closed-warning"].includes(e.kind))?.kind;
    return `- ${p.source} ${short(p.commit)} ${p.description}${how && how !== "merged" ? ` (${how})` : ""}`;
  });
  // Only patches with an acceptance check are listed; the others have nothing to report.
  const checked = acceptanceRows(run).filter(a => run.plan.find(p => p.display === a.patch)?.acceptance);
  return [
    `# debaser report, ${run.startedAt}`,
    "",
    r.code === 0 ? `Result: built ${built} with ${run.merged.length} ${run.merged.length === 1 ? "patch" : "patches"}.` : notDone,
    "",
    ...section("Upstream", [
      `Reset to ${short(run.upstream.tip)}${run.startTip ? `; ${r.pulled.length} new upstream commits since the last build` : ""}.`,
      ...r.pulled.slice(0, 20).map(c => `- ${short(c.sha)} ${c.subject}`),
      ...(r.pulled.length > 20 ? [`- and ${r.pulled.length - 20} more`] : []),
    ]),
    ...rebased,
    ...section("Merged patches", merged),
    ...section("Skipped", [
      ...of("skipped-merged").map(e => `- ${e.patch}: merged upstream; remove it from the list`),
      ...of("skipped-contained").map(e => `- ${e.patch}: already contained in the branch`),
    ]),
    ...section("Warnings and notes", [
      ...of("closed-warning").map(e => `- ${e.patch}: ${e.detail}`),
      ...of("warning").map(e => `- warning: ${e.patch}: ${e.detail}`),
      ...of("note").map(e => `- ${e.patch}: ${e.detail}`),
      ...of("rebase-note").map(e => `- ${e.detail}`),
      ...of("flaky").map(e => `- ${e.patch ? `acceptance check of ${e.patch}` : e.step} failed once and passed when run again; it may be flaky (log: ${basename(e.detail ?? "")})`),
    ]),
    ...section("Agent-resolved merges", of("agent-resolved").map(e => `- ${e.patch}: ${run.conflicts.findLast(c => c.patch === e.patch)?.files.join(", ")}`)),
    ...section(
      "Fix commits",
      run.fixes.map(
        f =>
          `- ${short(f.commit)} ${f.acceptance ? `acceptance ${f.acceptance}` : f.step} (${f.by}): ${f.files.join(", ")}` +
          (f.by === "agent" && f.attribution?.length === 0 ? " (no merged patch touches these files or the files the failure names; no handoff)" : ""),
      ),
    ),
    ...harness,
    ...section("Verification", stepResults(ctx, run, r.code).map(s => `- ${s.name}: ${stepWords[s.result]}`)),
    ...(checked.length ? section("Acceptance checks", checked.map(a => `- ${a.patch}: ${a.result}`)) : []),
    ...section("Needs a rebase onto upstream", r.mergeCheck.filter(p => p.clean === false).map(p => `- ${p.display}: ${p.files.join(", ")}`)),
    ...section("Clashes between patches", clashes(ctx.repo, run, r.mergeCheck)),
    ...handoffs,
    ...section("Rollback", [
      r.code === 0
        ? "`debaser rollback` returns to the previous build (`<branch>-prev` and the installed artifact's `.prev` copy)."
        : "`debaser rollback` returns to the branch and artifact this run started from.",
    ]),
  ].join("\n");
}

/** Each patch's acceptance result: its check's, `none` without one, `skipped` when not merged. */
export function acceptanceRows(run: RunState): { patch: string; result: string }[] {
  return run.plan.map(p => {
    const known = run.acceptance.findLast(a => a.patch === p.display);
    if (p.skip) return { patch: p.display, result: "skipped" };
    if (known) return { patch: p.display, result: known.result };
    return { patch: p.display, result: p.acceptance ? "not run" : "none" };
  });
}

function result(
  ctx: Context,
  run: RunState,
  r: {
    code: number;
    pulled: unknown[];
    mergeCheck: MergeCheck[];
    handoffs: string[];
    artifact?: { installed: string | null; previous: string | null };
  },
) {
  const list = listOf(ctx),
    handoffOf = (shown: string) => r.handoffs.find(h => basename(h).startsWith(`${shown.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`)),
    acceptance = new Map(acceptanceRows(run).map(a => [a.patch, a.result])),
    // An acceptance stop comes after every project-wide step passed: no patch fails the checks.
    acceptanceStop = !!run.stopped && !!run.stopFailure?.acceptance,
    stoppedOn = run.stopped && run.stopFailure && !acceptanceStop ? new Set(run.stopFailure.attribution.map(a => a.patch)) : new Set<string>();
  const patches = run.plan.map(p => {
    const check = r.mergeCheck.find(c => c.display === p.display),
      rebased = run.rebased?.find(x => x.patch === p.display);
    return {
      source: p.source,
      display: p.display,
      state: p.skip === "merged" ? "skipped-merged" : p.skip === "contained" ? "skipped-contained" : p.merge ? "merged" : "not-merged",
      ...(p.prLink ? (p.source.kind === "pr" ? { pr: { state: p.prState ?? "UNKNOWN", url: p.prLink } } : { link: p.prLink }) : {}),
      ...(rebased ? { rebase: rebased.outcome } : {}),
      ...(check?.clean === false ? { merges: false } : check?.clean ? { merges: true } : {}),
      ...(p.merge ? { checks: stoppedOn.has(p.display) ? "fail" : r.code === 0 || acceptanceStop ? "pass" : "unknown" } : {}),
      acceptance: acceptance.get(p.display) ?? "none",
      ...(handoffOf(p.display) ? { handoff: handoffOf(p.display) } : {}),
    };
  });
  for (const p of list.retired) patches.push({ source: p.source, display: display(p.source), state: "retired", acceptance: "skipped" } as never);
  return {
    version: 1,
    command: run.kind,
    // Runs from before the build directory worked where the integration branch was checked out.
    ...(run.kind === "build" ? { tree: run.tree ?? ctx.repo } : {}),
    outcome: outcomeOf(r.code),
    exitCode: r.code,
    upstream: { ref: run.upstream.ref, tip: run.upstream.tip, newCommits: r.pulled.length },
    patches,
    steps: run.kind === "build" ? stepResults(ctx, run, r.code) : [],
    harness: harnessTotals(run.harnessUsage ?? []),
    ...(r.artifact ? { artifact: r.artifact } : {}),
    report: join(run.reportDir, "report.md"),
  };
}

/** The `result.json` of a run directory, or undefined. */
export function resultOf(reportDir: string): unknown {
  const path = join(reportDir, "result.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}
/** A build report's result.json as later commands read it back. */
export type BuildResult = { command?: string; outcome?: string; patches?: unknown };
/** The newest kept build report's result that `accept` takes, or null; an
 * unreadable report is passed over. "rebuild" is what versions before the
 * rename wrote. */
export function lastBuildResult(reportsDir: string, accept: (r: BuildResult) => boolean = () => true): BuildResult | null {
  for (const name of reportDirs(reportsDir).reverse()) {
    let result: BuildResult | undefined;
    try {
      result = resultOf(join(reportsDir, name)) as BuildResult | undefined;
    } catch {
      continue;
    }
    if (result && typeof result === "object" && (result.command === "build" || result.command === "rebuild") && accept(result)) return result;
  }
  return null;
}
/** The `sourceKey`s of a build result's patches in `state`, in merge order;
 * malformed entries (from a hand-edited or foreign report) are left out. */
export function resultKeys(result: BuildResult, state: string): string[] {
  if (!Array.isArray(result.patches)) return [];
  return result.patches.flatMap(p => {
    if (!p || typeof p !== "object" || p.state !== state || !p.source || typeof p.source !== "object") return [];
    try {
      return [sourceKey(p.source as Source)];
    } catch {
      return [];
    }
  });
}

/** Points `reports/latest` at the newest run. */
export function linkLatest(reportsDir: string, runDir: string): void {
  const link = join(reportsDir, "latest");
  try {
    if (lstatSync(link)) unlinkSync(link);
  } catch {}
  symlinkSync(basename(runDir), link, "dir");
}
/** Deletes all but the `keep` newest run directories, and all but the `keep`
 * newest logs of rollbacks made without a stopped run (FR-047). */
export function prune(reportsDir: string, keep = 10): void {
  for (const prefix of ["", "rollback-"]) {
    const dirs = reportDirs(reportsDir, prefix);
    for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) rmSync(join(reportsDir, name), { recursive: true, force: true });
  }
}
/** The names of the run directories (`prefix` "") or rollback logs (`prefix`
 * "rollback-") under `reportsDir`, oldest first. */
export function reportDirs(reportsDir: string, prefix = ""): string[] {
  if (!existsSync(reportsDir)) return [];
  const pattern = new RegExp(`^${prefix}\\d{8}-\\d{6}(-\\d+)?$`);
  return readdirSync(reportsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && pattern.test(e.name))
    .map(e => e.name)
    .sort((a, b) => order(a.slice(prefix.length)) - order(b.slice(prefix.length)) || a.localeCompare(b));
}
/** Sorts `20261104-100000-2` after `20261104-100000`. */
function order(name: string): number {
  const [day, time, n] = name.split("-");
  return Number(day) * 1e8 + Number(time) * 100 + Number(n ?? 1);
}
