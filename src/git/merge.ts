import { git, lines, must, revParse, type Output } from "./git";

export function mergeNoFF(cwd: string, commit: string, message: string): Output {
  return git(cwd, ["merge", "--no-ff", "--no-edit", "-m", message, commit], { rerere: true });
}
export function mergeInProgress(cwd: string): boolean {
  return revParse(cwd, "MERGE_HEAD") !== null;
}
export function unmergedFiles(cwd: string): string[] {
  return lines(git(cwd, ["diff", "--name-only", "--diff-filter=U"]).stdout);
}
/** Concludes the merge in progress, letting rerere record its resolution. */
export function commitMerge(cwd: string, message: string): string {
  must(cwd, ["commit", "--no-verify", "-m", message], { rerere: true });
  return must(cwd, ["rev-parse", "HEAD"]);
}
/** `ref` merged onto `base` in the object database only: the result tree, or the conflicted files. */
function mergeTree(cwd: string, base: string, ref: string): { clean: boolean; files: string[]; tree: string } {
  const out = git(cwd, ["merge-tree", "--write-tree", "--name-only", "--no-messages", base, ref]);
  if (out.code !== 0 && out.code !== 1) throw Error(`git merge-tree failed: ${out.stderr.trim()}`);
  // The first line is the tree; the conflicted files follow.
  const [tree, ...files] = lines(out.stdout);
  return { clean: out.code === 0, files: out.code === 0 ? [] : [...new Set(files)], tree };
}
/** Whether `ref` merges cleanly onto `base`, without touching the working tree. */
export function mergeTreeCheck(cwd: string, base: string, ref: string): { clean: boolean; files: string[] } {
  const { clean, files } = mergeTree(cwd, base, ref);
  return { clean, files };
}
/** `ref` merged onto `base` without a working tree, index or ref change (spec
 * 003, FR-013): a clean result becomes an unreachable commit later merges can
 * build on, made with a fixed identity so no configured user is needed. */
export function mergeOnto(cwd: string, base: string, ref: string): { clean: boolean; files: string[]; commit?: string } {
  const { clean, files, tree } = mergeTree(cwd, base, ref);
  if (!clean) return { clean, files };
  const env = { ...process.env, GIT_AUTHOR_NAME: "debaser", GIT_AUTHOR_EMAIL: "debaser", GIT_COMMITTER_NAME: "debaser", GIT_COMMITTER_EMAIL: "debaser" };
  return { clean, files, commit: must(cwd, ["commit-tree", tree, "-p", base, "-p", ref, "-m", "debaser propose"], { env }) };
}
export function filesTouchedByMerge(cwd: string, merge: string): string[] {
  return lines(git(cwd, ["diff", "--name-only", `${merge}^1`, merge]).stdout);
}
/** Redoes a merge whose resolution was rejected: conflict markers back in
 * `files`, and anything rerere recorded for them forgotten so it never replays. */
export function remerge(cwd: string, commit: string, message: string, files: string[]): void {
  git(cwd, ["-c", "rerere.enabled=true", "-c", "rerere.autoUpdate=false", "merge", "--no-ff", "--no-edit", "-m", message, commit]);
  if (!mergeInProgress(cwd)) return;
  git(cwd, ["-c", "rerere.enabled=true", "rerere", "forget", "--", ...files]);
  git(cwd, ["checkout", "-m", "--", ...files]);
  // Paths rerere replayed in the first merge were staged by autoUpdate; this
  // merge replays them without staging, so stage them again or every later
  // attempt is rejected as still unmerged.
  const replayed = unmergedFiles(cwd).filter(path => !files.includes(path));
  if (replayed.length) git(cwd, ["add", "--", ...replayed]);
}
/** A merge or a rebase stopped at a conflict. */
export function conflictInProgress(cwd: string): boolean {
  return mergeInProgress(cwd) || revParse(cwd, "REBASE_HEAD") !== null;
}
