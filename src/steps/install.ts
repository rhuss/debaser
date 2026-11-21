import { existsSync } from "node:fs";
import { join } from "node:path";
import { git } from "../git/git";
import type { EffectiveRecipe } from "../recipes/types";

/** Whether the install step must run in `tree`: nothing is installed yet (its
 * marker is missing), or a trigger file changed since `since`. */
export function installNeeded(tree: string, recipe: EffectiveRecipe, since: string): boolean {
  const install = recipe.install;
  if (!install) return false;
  if (install.marker && !existsSync(join(tree, install.marker))) return true;
  if (!install.triggers.length) return !install.marker;
  return git(tree, ["diff", "--quiet", since, "HEAD", "--", ...install.triggers]).code !== 0;
}
