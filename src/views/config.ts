/** The configuration header `list` and `status` start with (FR-017): where the
 * data directory, the patch list, the local recipe and the build directory are,
 * as paths only. */
import type { configInfo } from "../core/tree";
import { paint } from "../live/term";

export type ConfigInfo = ReturnType<typeof configInfo>;

/** What the `build` line adds about the build directory's state, or null when all is well. */
function treeNote(info: ConfigInfo, branch: string, branchExists: boolean): string | null {
  const t = info.tree;
  if (!t.exists) return t.recorded ? "missing" : "not created yet";
  const modified = t.modified.length ? `${t.modified.length} modified file${t.modified.length === 1 ? "" : "s"}` : null;
  if (t.inPlace) return modified ? `in place, ${modified}` : "in place";
  if (!t.ours) return "not a worktree of this repository";
  if (t.branch !== null && t.branch !== branch) return `on ${t.branch}, not ${branch}`;
  // Detached is debaser's own state until the integration branch exists.
  if (t.branch === null && branchExists) return `on a detached HEAD, not ${branch}`;
  return modified;
}

export function configHeader(info: ConfigInfo, o: { color: boolean; branch: string; branchExists: boolean }): string[] {
  const dim = (text: string) => paint(text, "dim", o.color),
    note = treeNote(info, o.branch, o.branchExists);
  return [
    `${dim("data  ")}  ${info.dir}`,
    `${dim("config")}  ${info.patchList}  ${dim(`(local recipe: ${info.localRecipe ?? "none"})`)}`,
    `${dim("build ")}  ${info.tree.path}${note ? `  ${dim(`(${note})`)}` : ""}`,
  ];
}
