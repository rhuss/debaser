import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as git from "../git/git";
import { conflictInProgress, unmergedFiles } from "../git/merge";
import { changedSince, type Snapshot } from "../git/snapshot";
import { buildLeftover } from "../run/leftover";
import type { Call } from "./invoke";

/** A rejected call carries `broken` when it exited non-zero (or its stream
 * reported a failure) without an acceptable result: a harness that fails to
 * start fails the same way on the next attempt, so its tries end at once. */
export type Verdict = { ok: true; files: string[] } | { ok: false; reason: string; broken: boolean };
export const changedNothing = "it changed nothing";
const marker = (line: string) => line.startsWith("<<<<<<< ") || line.startsWith(">>>>>>> ") || line === "=======";

/** Whether the harness resolved the conflict (FR-019, FR-035a): the merge or
 * rebase is still in progress, HEAD is unchanged, no markers remain and only
 * the conflicted files changed. On success the files are staged. */
export function acceptConflict(repo: string, call: { files: string[]; head: string; snapshot: Snapshot }, exclude: string[] = []): Verdict {
  const no = (reason: string): Verdict => ({ ok: false, reason, broken: false });
  if (git.revParse(repo, "HEAD") !== call.head) return no("it committed");
  if (!conflictInProgress(repo)) return no("it ended the merge or rebase");
  const outside = changedSince(repo, call.snapshot, exclude).filter(path => !call.files.includes(path));
  if (outside.length) return no(`it changed files outside the conflict: ${outside.join(", ")}`);
  for (const file of call.files) {
    const path = join(repo, file);
    if (existsSync(path) && readFileSync(path, "utf8").split("\n").some(marker)) return no(`conflict markers remain in ${file}`);
  }
  git.must(repo, ["add", "-A", "--", ...call.files]);
  const left = unmergedFiles(repo);
  if (left.length) return no(`still unmerged: ${left.join(", ")}`);
  return { ok: true, files: call.files };
}
/** Whether the harness changed anything for a fix (FR-020); a commit it made
 * is undone with its changes kept, so debaser commits them itself. */
export function acceptFix(repo: string, call: { head: string; snapshot: Snapshot }, exclude: string[] = []): Verdict {
  if (git.revParse(repo, "HEAD") !== call.head) git.must(repo, ["reset", "--quiet", "--soft", call.head]);
  const files = changedSince(repo, call.snapshot, exclude).filter(path => !buildLeftover(path));
  return files.length ? { ok: true, files } : { ok: false, reason: changedNothing, broken: false };
}
/** The verdict on a finished call: a timeout, or `accept`'s verdict on what
 * it left. A rejected call that exited non-zero, or whose stream reported a
 * failure, is reported by that instead and is `broken`. */
export function judge(call: Call, timeoutSeconds: number, accept: () => Verdict): Verdict {
  if (call.timedOut) return { ok: false, reason: `it timed out after ${timeoutSeconds}s`, broken: false };
  const verdict = accept();
  if (verdict.ok) return verdict;
  if (call.code) return { ok: false, reason: `it exited ${call.code}${call.tail ? `: ${call.tail}` : ""}`, broken: true };
  if (call.failed) return { ok: false, reason: call.failed, broken: true };
  return verdict;
}
/** Undoes what a rejected attempt changed: back to `head`, without files it created. */
export function discard(repo: string, head: string, before: Snapshot, exclude: string[] = []): void {
  const created = changedSince(repo, before, exclude).filter(path => !(path in before));
  git.git(repo, ["merge", "--abort"]);
  git.must(repo, ["reset", "--quiet", "--hard", head]);
  for (const path of created) if (git.git(repo, ["cat-file", "-e", `HEAD:${path}`]).code !== 0) rmSync(join(repo, path), { force: true });
}
/** A verdict as a recorded call's outcome. */
export const outcome = (verdict: Verdict): { ok: boolean; reason?: string } => (verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason });
