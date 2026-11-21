import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import type { Context } from "../core/context";
import { listOf, recipeOf } from "../core/context";
import type { Attribution, RunState } from "../core/runstate";
import * as git from "../git/git";
import { fill, template } from "../harness/prompts";
import { display as displayOf, link, slug } from "../plugins/sources/parse";
import { expand } from "../steps/commands";
import { stepVars, upstreamLine } from "../run/common";

export type HandoffKind = "rebase" | "rebase-checks" | "build-drift" | "build-clash" | "acceptance";
export type Handoff = {
  kind: HandoffKind;
  patch: string;
  description: string;
  link: string;
  upstream: string;
  problem: string;
  cause: string;
  fix: string;
  checkout: string;
  task: string;
};
export type MergeCheck = { display: string; clean: boolean | null; files: string[] };

/** Writes a handoff for one patch from the template; returns its path. */
export function writeHandoff(reportDir: string, text: string, h: Handoff): string {
  const dir = join(reportDir, "handoffs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug(h.patch)}.md`);
  writeFileSync(path, fill(text, h));
  return path;
}
/** One handoff per patch (FR-026): several problems of one patch become one
 * file, each problem, cause, fix and task in turn. */
function combine(list: Handoff[]): Handoff[] {
  const byPatch = new Map<string, Handoff[]>();
  for (const h of list) byPatch.set(h.patch, [...(byPatch.get(h.patch) ?? []), h]);
  return [...byPatch.values()].map(group => {
    if (group.length === 1) return group[0];
    const unique = (values: string[]) => [...new Set(values)];
    return {
      ...group[0],
      kind: unique(group.map(h => h.kind)).join(", ") as HandoffKind,
      problem: group.map((h, i) => `${i + 1}. (${h.kind}) ${h.problem}`).join("\n\n"),
      cause: unique(group.map(h => h.cause)).join("; "),
      fix: unique(group.map(h => h.fix)).join("\n\n"),
      task: unique(group.map(h => h.task)).join("\n>\n> "),
    };
  });
}

function base(ctx: Context, run: RunState, shown: string, upstream: string) {
  const p = run.plan.find(p => p.display === shown),
    source = p?.source ?? listOf(ctx).patches.find(c => displayOf(c.source) === shown)?.source,
    checkout =
      source?.kind === "branch"
        ? `branch ${source.name}`
        : source?.kind === "fork-branch"
          ? `branch ${source.branch} of ${source.repo ?? source.url}`
          : `the head branch of ${shown}`;
  return {
    patch: shown,
    description: p?.description ?? listOf(ctx).patches.find(c => displayOf(c.source) === shown)?.description ?? "",
    link: p?.prLink ?? (source ? link(source) : null) ?? checkout,
    upstream,
    checkout,
  };
}
const commandOf = (ctx: Context, step: string) => {
  const s = recipeOf(ctx).steps.find(x => x.name === step);
  return s ? expand(s.run, stepVars(ctx, ctx.repo)).join(" ") : step;
};
const excerpt = (log: string | undefined, n = 40) => (log && existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n").slice(-n) : []);

/** One handoff per affected patch (FR-026); a stopped and continued run
 * writes its report again, so the set is rewritten each time. */
export function writeHandoffs(ctx: Context, run: RunState, mergeCheck: MergeCheck[]): string[] {
  const text = template("handoff", recipeOf(ctx).prompts),
    upstream = upstreamLine(ctx, run),
    branch = listOf(ctx).upstream.branch,
    found: Handoff[] = [];
  rmSync(join(run.reportDir, "handoffs"), { recursive: true, force: true });
  for (const r of mergeCheck.filter(r => r.clean === false))
    found.push({
        ...base(ctx, run, r.display, upstream),
        kind: "rebase",
        problem: `Merging it alone onto upstream ${branch} conflicts in:\n\n${r.files.map(f => `- ${f}`).join("\n")}`,
        cause: `upstream ${branch} moved on`,
        fix: "none",
        task: `Rebase this branch onto the latest upstream ${branch} and resolve the conflicts in ${r.files.join(", ")}, keeping the change's intent. Check that the project's checks still pass.`,
      });
  const handed = new Set(mergeCheck.filter(r => r.clean === false).map(r => r.display));
  for (const r of run.rebased ?? []) {
    if (r.outcome !== "failed") continue;
    if (r.step) {
      const command = commandOf(ctx, r.step);
      found.push({
          ...base(ctx, run, r.patch, upstream),
          kind: "rebase-checks",
          problem: `Rebased onto upstream ${branch}, \`${command}\` (${r.step}) fails on ${r.branch} alone:\n\n\`\`\`text\n${excerpt(r.log).join("\n")}\n\`\`\``,
          cause: `upstream ${branch} moved on`,
          fix: `none; ${r.branch} kept its old tip ${r.from.slice(0, 7)}`,
          task: `Rebase this branch onto the latest upstream ${branch} and make \`${command}\` pass, keeping the change's intent. Check that the project's checks pass.`,
        });
    } else if (!handed.has(r.patch))
      found.push({
          ...base(ctx, run, r.patch, upstream),
          kind: "rebase",
          problem: `Rebasing ${r.branch} onto upstream ${branch} stopped: ${r.reason}.`,
          cause: `upstream ${branch} moved on`,
          fix: "none",
          task: `Rebase this branch onto the latest upstream ${branch} and resolve the conflicts, keeping the change's intent. Check that the project's checks still pass.`,
        });
  }
  const attributed = (step: string, log: string | undefined, a: Attribution, fix: string, hint: string) => {
    const command = commandOf(ctx, step);
    found.push({
        ...base(ctx, run, a.patch, upstream),
        kind: a.kind,
        problem: `\`${command}\` (${step}) failed in the patched build:\n\n\`\`\`text\n${excerpt(log).join("\n")}\n\`\`\``,
        cause:
          a.kind === "build-drift"
            ? `upstream ${branch} moved on`
            : a.others.length
              ? `clashes with: ${a.others.join(", ")}`
              : "clashes with the other changes in this build",
        fix,
        task:
          a.kind === "build-drift"
            ? `With this branch merged alone onto the latest upstream ${branch}, \`${command}\` fails. Update the branch onto upstream ${branch} and fix it${hint}.`
            : `This branch and ${a.others.join(", ")} fail \`${command}\` only when merged together. Decide with their authors which side adapts, or wait until one of them is merged upstream, then update this branch if it is the one to change.`,
      });
  };
  const acceptanceHandoff = (patch: string, log: string | undefined, fix: string) => {
    const check = run.plan.find(p => p.display === patch)?.acceptance,
      command = check ? check.run.join(" ") : "its acceptance check";
    found.push({
        ...base(ctx, run, patch, upstream),
        kind: "acceptance",
        problem: `The acceptance check \`${command}\` fails on the patched build:\n\n\`\`\`text\n${excerpt(log).join("\n")}\n\`\`\``,
        cause: "the build no longer does what this patch is for",
        fix,
        task: `Make \`${command}\` pass again on a build of this branch merged onto the latest upstream ${branch}, keeping the change's intent.`,
      });
  };
  for (const fix of run.fixes) {
    const stat = git.git(ctx.repo, ["show", "--stat", "--format=", fix.commit]).stdout.trimEnd(),
      shown = `${fix.commit.slice(0, 7)} debaser: fix ${fix.acceptance ? `acceptance ${fix.acceptance}` : fix.step} (${fix.by})\n\n\`\`\`text\n${stat}\n\`\`\``;
    if (fix.acceptance) {
      acceptanceHandoff(fix.acceptance, fix.log, shown);
      continue;
    }
    for (const a of fix.attribution ?? []) attributed(fix.step, fix.log, a, shown, "; the fix the patched build applied is shown above as a hint");
  }
  // A run stopped at a failing step hands it to the patches it points at before anyone fixed it.
  const stopped = run.stopped ? run.stopFailure : null;
  if (stopped?.acceptance)
    for (const a of run.acceptance.filter(a => a.result === "fail")) acceptanceHandoff(a.patch, a.log, "none; the patched build stopped on it");
  else for (const a of stopped?.attribution ?? []) attributed(stopped!.step, stopped!.log, a, "none; the patched build stopped on it", "");
  return combine(found).map(h => writeHandoff(run.reportDir, text, h));
}
