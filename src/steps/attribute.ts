import { existsSync, readFileSync } from "node:fs";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { Attribution, RunState } from "../core/runstate";
import { filesTouchedByMerge } from "../git/merge";
import { failureText } from "../plugins/parsers/generic";
import { forStep } from "../plugins/parsers/registry";
import { runIsolated } from "./isolated";

export type Merged = { display: string; ref: string; merge: string };
/** Who a failure of `step` points at (FR-027): the merged patches whose changed
 * files a fix changed or the failure names (from the step's parser, or the
 * paths named in the log outside lines that hold nothing but a path), each run
 * alone on upstream. Those that fail alone drifted from upstream; if none
 * does, the implicated patches clash with each other. With no candidate,
 * nothing is run and nothing handed off. */
export async function attribute(
  ctx: Context,
  run: RunState,
  o: { step: string; merged: Merged[]; fixFiles: string[]; log: string },
): Promise<Attribution[]> {
  const step = recipeOf(ctx).steps.find(s => s.name === o.step),
    text = existsSync(o.log) ? readFileSync(o.log, "utf8") : "",
    named = step?.parser ? forStep(step.parser).parse(text, ctx.repo).implicatedPaths : [],
    scanned = failureText(text),
    implicated = o.merged.filter(m =>
      filesTouchedByMerge(ctx.repo, m.merge).some(file => o.fixFiles.includes(file) || named.includes(file) || scanned.includes(file)),
    ),
    failing: string[] = [];
  if (!implicated.length) {
    ctx.progress(
      o.fixFiles.length
        ? `no merged patch touches what the ${o.step} fix changed or the failure names; not attributed`
        : `no merged patch touches a file the ${o.step} failure names; not attributed`,
    );
    return [];
  }
  for (const [i, m] of implicated.entries()) {
    const left = implicated.length - i - 1;
    ctx.progress(`running ${o.step} with ${m.display} alone on upstream (${i + 1} of ${implicated.length}, ${left} left)`);
    const alone = await runIsolated(ctx, run, `attribute-${m.merge.slice(0, 7)}`, run.upstream.tip, [m.ref], o.step);
    if (alone === "failed") failing.push(m.display);
  }
  if (failing.length) return failing.map(patch => ({ kind: "build-drift", patch, others: [] }));
  // A clash needs two sides: a lone implicated patch clashes with the rest merged.
  const sides = implicated.length > 1 ? implicated : o.merged;
  return implicated.map(m => ({
    kind: "build-clash",
    patch: m.display,
    others: sides.filter(other => other !== m).map(other => other.display),
  }));
}
