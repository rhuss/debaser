import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { commonDirOf } from "../core/paths";
import { git, must } from "./git";

export function addWorktree(cwd: string, path: string, commit: string): void {
  must(cwd, ["worktree", "add", "--quiet", "--detach", "--force", path, commit]);
}
/** Removes the worktree at `path`; when its directory is already gone, only its
 * own registration is dropped, never other worktrees'. */
export function removeWorktree(cwd: string, path: string): void {
  if (git(cwd, ["worktree", "remove", "--force", path]).code === 0) return;
  const admin = join(commonDirOf(cwd), "worktrees");
  if (!existsSync(admin)) return;
  // macOS reports temporary paths with and without /private.
  const same = (a: string, b: string) => a.replace(/^\/private\//, "/") === b.replace(/^\/private\//, "/");
  for (const name of readdirSync(admin)) {
    const gitdir = join(admin, name, "gitdir");
    if (existsSync(gitdir) && same(readFileSync(gitdir, "utf8").trim(), join(path, ".git")))
      rmSync(join(admin, name), { recursive: true, force: true });
  }
}
/** Another worktree than the one at `cwd` that has `branch` checked out, or null. */
export function worktreeWith(cwd: string, branch: string): string | null {
  const here = must(cwd, ["rev-parse", "--show-toplevel"]);
  let path = "";
  for (const line of git(cwd, ["worktree", "list", "--porcelain"]).stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}` && realpath(path) !== realpath(here)) return path;
  }
  return null;
}
/** The worktree, the current one included, that has `branch` checked out, or null. */
export function checkedOutIn(cwd: string, branch: string): string | null {
  let path = "";
  for (const line of git(cwd, ["worktree", "list", "--porcelain"]).stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}
function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
