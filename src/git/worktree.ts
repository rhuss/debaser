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
    const entry = join(admin, name),
      gitdir = join(entry, "gitdir");
    if (!existsSync(gitdir)) continue;
    const target = readFileSync(gitdir, "utf8").trim();
    // A locked entry (its directory on a volume that is away) or one whose
    // directory still exists is never dropped here; git refused it for a reason.
    if (existsSync(join(entry, "locked")) || existsSync(target)) continue;
    if (same(target, join(path, ".git"))) rmSync(entry, { recursive: true, force: true });
  }
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
/** The repository's main worktree (the first `git worktree list` entry), realpath'd. */
export function mainWorktree(cwd: string): string {
  const first = git(cwd, ["worktree", "list", "--porcelain"]).stdout.split("\n").find(line => line.startsWith("worktree "));
  if (!first) throw Error("git worktree list named no worktree");
  return realpath(first.slice("worktree ".length));
}
/** The registered worktree at `path` (live or stale), with its branch (null when
 * detached) and whether it is locked, or null when none is registered there. */
export function worktreeAt(cwd: string, path: string): { branch: string | null; locked: boolean } | null {
  let at = "",
    found: { branch: string | null; locked: boolean } | null = null;
  for (const line of git(cwd, ["worktree", "list", "--porcelain"]).stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      at = line.slice("worktree ".length);
      if (samePath(at, path)) found = { branch: null, locked: false };
      else if (found) return found;
    } else if (found && line.startsWith("branch refs/heads/")) found.branch = line.slice("branch refs/heads/".length);
    else if (found && (line === "locked" || line.startsWith("locked "))) found.locked = true;
  }
  return found;
}
/** Whether two paths name the same place: realpath'd, and tolerant of macOS's
 * `/private` prefix for paths that no longer exist. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => realpath(p).replace(/^\/private\//, "/");
  return norm(a) === norm(b);
}
export function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
