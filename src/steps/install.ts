import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, must } from "../git/git";
import type { EffectiveRecipe } from "../recipes/types";

/** The stamp an install that passed leaves in the worktree's own git directory,
 * so a worktree that never had one (a new build directory) is known to have
 * nothing installed, whatever happened to the run that created it (FR-010). */
const stamp = (tree: string) => join(must(tree, ["rev-parse", "--absolute-git-dir"]), "debaser-installed");

/** Records that the install step passed in `tree`. */
export function markInstalled(tree: string): void {
  writeFileSync(stamp(tree), "");
}

/** Whether the install step must run in `tree`: nothing is installed yet (its
 * marker is missing, or without a marker, no install ever passed in this
 * worktree), or a trigger file changed since `since`. */
export function installNeeded(tree: string, recipe: EffectiveRecipe, since: string): boolean {
  const install = recipe.install;
  if (!install) return false;
  if (install.marker && !existsSync(join(tree, install.marker))) return true;
  if (!install.triggers.length) return !install.marker;
  if (!install.marker && !existsSync(stamp(tree))) return true;
  return git(tree, ["diff", "--quiet", since, "HEAD", "--", ...install.triggers]).code !== 0;
}
