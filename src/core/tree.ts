/** The build directory (spec 002): the one worktree per project that holds the
 * integration branch. `build`, `continue` and `rollback` work there, never in
 * the checkout debaser was started from. */
import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import type { Context } from "./context";
import { listOf, upstreamRemote } from "./context";
import { Explained } from "./errors";
import * as patchlist from "./patchlist";
import { commonDirOf, paths } from "./paths";
import type { RunState } from "./runstate";
import * as git from "../git/git";
import { word } from "../steps/commands";
import { checkedOutIn, mainWorktree, realpath, removeWorktree, samePath, worktreeAt } from "../git/worktree";

export type BuildDirectory = {
  /** Absolute, resolved against the main worktree. */
  path: string;
  /** The path came from `patches.json`; false: the default, not recorded yet. */
  recorded: boolean;
  exists: boolean;
  /** It is a worktree of this repository (its top level, sharing this repository's git directory). */
  ours: boolean;
  /** It is the main worktree itself (US5). */
  inPlace: boolean;
  /** The branch checked out there; null when detached, missing or foreign. */
  branch: string | null;
  /** Modified tracked files there. */
  modified: string[];
};

/** The default build directory, relative to the main worktree. */
const defaultTree = (main: string) => `../${basename(main)}-debaser`;

/** Where the build directory is: `tree` from the patch list, else beside the main worktree. */
export function treePath(ctx: Context): { path: string; recorded: boolean } {
  const main = mainWorktree(ctx.home),
    recorded = ctx.list?.tree;
  return { path: resolve(main, recorded ?? defaultTree(main)), recorded: recorded !== undefined };
}

/** Whether `path` is the top level of a worktree of the repository at `home`. */
function isOurs(home: string, path: string): boolean {
  const top = git.git(path, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || realpath(top.stdout.trim()) !== realpath(path)) return false;
  const common = git.git(path, ["rev-parse", "--git-common-dir"]);
  if (common.code !== 0) return false;
  const dir = common.stdout.trim();
  return realpath(isAbsolute(dir) ? dir : resolve(path, dir)) === realpath(commonDirOf(home));
}

/** The build directory's state, read only (for `status`, `list` and the refusals). */
export function inspect(ctx: Context): BuildDirectory {
  const { path, recorded } = treePath(ctx),
    exists = existsSync(path),
    ours = exists && isOurs(ctx.home, path);
  return {
    path,
    recorded,
    exists,
    ours,
    inPlace: exists && realpath(path) === mainWorktree(ctx.home),
    branch: ours ? git.currentBranch(path) : null,
    modified: ours ? git.modifiedFiles(path) : [],
  };
}

const listed = (files: string[]) => (files.length > 10 ? `${files.slice(0, 10).join(", ")} and ${files.length - 10} more` : files.join(", "));

/** A worktree other than `tree` that has `branch` checked out (live or stale), or null. */
function heldElsewhere(home: string, tree: string, branch: string): string | null {
  let at = "";
  for (const line of git.git(home, ["worktree", "list", "--porcelain"]).stdout.split("\n")) {
    if (line.startsWith("worktree ")) at = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}` && !samePath(at, tree)) return at;
  }
  return null;
}

/** Refuses when the integration branch is checked out in a worktree other than `tree` (FR-007, FR-016). */
function refuseHeldElsewhere(ctx: Context, tree: string): void {
  const list = listOf(ctx),
    elsewhere = heldElsewhere(ctx.home, tree, list.branch);
  if (!elsewhere) return;
  const main = mainWorktree(ctx.home);
  if (samePath(elsewhere, main))
    throw new Explained(
      `the main checkout (${main}) has ${list.branch} checked out; switch it away first: git -C ${word(main)} switch ${word(list.upstream.branch)}`,
    );
  throw new Explained(`${list.branch} is checked out in another worktree (${elsewhere}); switch it away first`);
}

/** Checks a stopped run's build directory before rollback resets it (FR-007).
 * The modified-files check doesn't apply: a stopped run's changes are its own.
 * Built in place, the checkout was the run's and goes back to the integration
 * branch as before; a separate build directory never switches branches on its own. */
export function refuseRollbackIn(ctx: Context, at: string): void {
  const list = listOf(ctx);
  refuseHeldElsewhere(ctx, at);
  if (samePath(at, mainWorktree(ctx.home))) return;
  const current = git.currentBranch(at);
  if (current !== list.branch)
    throw new Explained(
      `the build directory ${at} has ${current ?? "a detached HEAD"} checked out, not ${list.branch}; switch it back first, or set another path as "tree" in ${paths.patchList(ctx.dir)}`,
    );
}

/** Checks the build directory before a run changes the integration branch and
 * creates it when it is missing (FR-003, FR-007, FR-009); returns its realpath.
 * Every refusal leaves everything as it was. */
export function prepare(ctx: Context): string {
  const list = listOf(ctx),
    d = inspect(ctx),
    patchList = paths.patchList(ctx.dir);
  if (d.exists && !d.ours) throw new Explained(`${d.path} is not a worktree of this repository; set another path as "tree" in ${patchList}`);
  refuseHeldElsewhere(ctx, d.path);
  if (d.exists && !d.inPlace && d.branch !== list.branch && (d.branch !== null || git.branchExists(ctx.home, list.branch)))
    throw new Explained(
      `the build directory ${d.path} has ${d.branch ?? "a detached HEAD"} checked out, not ${list.branch}; switch it back first, or set another path as "tree" in ${patchList}`,
    );
  if (d.modified.length)
    throw new Explained(`the build directory ${d.path} has uncommitted changes in: ${listed(d.modified)}; commit, stash or discard them first`);
  if (d.exists) {
    // The default, created by a build that was cut short before recording it (FR-003).
    if (!d.recorded) {
      list.tree = defaultTree(mainWorktree(ctx.home));
      patchlist.save(ctx.dir, list);
    }
    return realpath(d.path);
  }
  // A directory deleted by hand leaves its registration behind: drop only that one.
  const registered = worktreeAt(ctx.home, d.path);
  // A locked one is away on purpose (an unmounted volume): never dropped (FR-008).
  if (registered?.locked)
    throw new Explained(`the build directory ${d.path} is a locked worktree that is not there; bring it back, or unlock it: git worktree unlock ${word(d.path)}`);
  const stale = registered !== null,
    // A directory debaser created (its default recorded, or still registered) was deleted by hand: say so (FR-009).
    missing = stale || (d.recorded && list.tree === defaultTree(mainWorktree(ctx.home))) ? " (it was missing)" : "";
  if (stale) removeWorktree(ctx.home, d.path);
  if (git.branchExists(ctx.home, list.branch)) {
    ctx.progress(`creating the build directory ${d.path} from ${list.branch}${missing}`);
    git.must(ctx.home, ["worktree", "add", "--quiet", d.path, list.branch]);
  } else {
    const remote = upstreamRemote(ctx),
      upstream = git.revParse(ctx.home, `refs/remotes/${remote}/${list.upstream.branch}`);
    ctx.progress(`creating the build directory ${d.path} from ${upstream ? `${remote}/${list.upstream.branch}` : "HEAD"}${missing}`);
    git.must(ctx.home, ["worktree", "add", "--quiet", "--detach", d.path, upstream ?? "HEAD"]);
  }
  if (!d.recorded) {
    list.tree = defaultTree(mainWorktree(ctx.home));
    patchlist.save(ctx.dir, list);
  }
  return realpath(d.path);
}

/** The checkout a stopped build run works in: its build directory (null when
 * it is gone), or for a run from before the build directory, the worktree that
 * has the integration branch checked out (FR-014). */
export function runTree(ctx: Context, run: RunState): string | null {
  if (run.tree) {
    if (!existsSync(run.tree)) return null;
    // Something else in its place is never written to (FR-008).
    if (!isOurs(ctx.home, run.tree))
      throw new Explained(`${run.tree} is no longer a worktree of this repository; move it away, then undo the run with \`debaser rollback\``);
    return run.tree;
  }
  const list = listOf(ctx),
    held = checkedOutIn(ctx.home, list.branch);
  // A registered worktree whose directory is gone holds the branch only on paper.
  if (!held || !existsSync(held))
    throw new Explained(`no worktree has ${list.branch} checked out; check it out again where the run was started`);
  return held;
}

/** Where debaser's configuration lives, as paths only (FR-017, FR-021). */
export function configInfo(ctx: Context): { dir: string; patchList: string; localRecipe: string | null; tree: BuildDirectory } {
  const local = paths.localRecipe(ctx.dir);
  return { dir: ctx.dir, patchList: paths.patchList(ctx.dir), localRecipe: existsSync(local) ? local : null, tree: inspect(ctx) };
}
