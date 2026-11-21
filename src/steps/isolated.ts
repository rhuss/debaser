import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../core/context";
import { recipeOf } from "../core/context";
import type { RunState } from "../core/runstate";
import * as git from "../git/git";
import { addWorktree, removeWorktree } from "../git/worktree";
import { stepEnv } from "../report/manifest";
import { expand } from "./commands";
import { runStep } from "./run";
import { stepVars, work } from "../run/common";

/** `conflict`: the merges don't apply on the base, so the step never ran. */
export type Isolated = "passed" | "failed" | "conflict";
/** Runs `step` in a throwaway worktree of `base` with `refs` merged in, never
 * touching the checkout (the plain-upstream rerun and attribution). The
 * install step and every step before `stepName` run first; logs go to
 * `isolated/<name>-<step>.log`. */
export async function runIsolated(ctx: Context, run: RunState, name: string, base: string, refs: string[], stepName: string): Promise<Isolated> {
  const recipe = recipeOf(ctx),
    path = join(work(ctx), `isolated-${name}`),
    logDir = join(run.reportDir, "isolated");
  removeWorktree(ctx.repo, path);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(work(ctx), { recursive: true });
  addWorktree(ctx.repo, path, base);
  const drop = () => {
    removeWorktree(ctx.repo, path);
    rmSync(path, { recursive: true, force: true });
  };
  // An interrupted run ends the process before `finally`; its throwaway
  // worktree (named per merge, so never reused) goes with it.
  const forget = git.onInterrupt(drop);
  try {
    for (const ref of refs)
      if (git.git(path, ["merge", "--no-ff", "--no-edit", "-m", `debaser: isolated merge ${ref}`, ref]).code !== 0) return "conflict";
    const env = stepEnv(ctx, run, path),
      once = (s: string) => {
        const step = recipe.steps.find(x => x.name === s)!;
        return runStep(expand(step.run, stepVars(ctx, path)), {
          cwd: path,
          log: join(logDir, `${name}-${s}.log`),
          env,
          echo: ctx.echo,
          timeout: step.timeout,
        });
      };
    // Every step before `stepName` runs first, as on the patched tree, so a
    // step that needs an earlier one's output (a native build before the
    // tests) isn't taken for broken on upstream. The install step runs first
    // even when the recipe lists it later.
    const index = recipe.steps.findIndex(x => x.name === stepName),
      install = recipe.install?.step,
      before = recipe.steps.slice(0, Math.max(index, 0)).map(x => x.name);
    const order = install && install !== stepName && !before.includes(install) ? [install, ...before] : before;
    for (const s of order) if (!(await once(s))) return "failed";
    return (await once(stepName)) ? "passed" : "failed";
  } finally {
    forget();
    drop();
  }
}
