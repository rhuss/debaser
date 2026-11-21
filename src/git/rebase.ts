import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, must, revParse, stopIfInterrupted, type Output } from "./git";

/** Settings that would change what a rebase replays, or move the user's
 * branches behind debaser's back, pinned to git's defaults. */
const pinned = [
  "-c",
  "rebase.abbreviateCommands=false",
  "-c",
  "rebase.missingCommitsCheck=ignore",
  "-c",
  "rebase.autoSquash=false",
  "-c",
  "rebase.updateRefs=false",
  "-c",
  "rebase.rebaseMerges=false",
];
function rebaseGit(cwd: string, args: string[], env: Record<string, string> = {}): Output {
  return git(cwd, [...pinned, ...args], { rerere: true, env: { ...process.env, GIT_EDITOR: "true", ...env } });
}
/** Rebases `branch` onto `onto` with the commits git picks against `upstream`
 * (cherry-picked ones left out, as in the first rebase), minus `drop`: the
 * commits already replayed into `onto`. `editor` is a script that turns the
 * `pick` lines of the commits in `$DEBASER_DROP` into drops. */
export function rebaseKeepingTodo(cwd: string, o: { onto: string; upstream: string; branch: string; drop: string[]; editor: string }): Output {
  return rebaseGit(
    cwd,
    ["rebase", "-i", "--no-autosquash", "--no-update-refs", "--no-rebase-merges", "--empty=drop", "--onto", o.onto, o.upstream, o.branch],
    { GIT_SEQUENCE_EDITOR: `sh '${o.editor.replaceAll("'", "'\\''")}'`, DEBASER_DROP: o.drop.join(" ") },
  );
}
/** Starts rebasing the checkout at `cwd` onto `onto`; check `rebaseInProgress` for a stop. */
export function rebase(cwd: string, onto: string): Output {
  return rebaseGit(cwd, ["rebase", "--no-update-refs", "--no-rebase-merges", onto]);
}
export function rebaseContinue(cwd: string): Output {
  return rebaseGit(cwd, ["rebase", "--continue"]);
}
export function rebaseAbort(cwd: string): void {
  git(cwd, ["rebase", "--abort"]);
}
export function rebaseInProgress(cwd: string): boolean {
  return ["rebase-merge", "rebase-apply"].some(name => {
    const out = git(cwd, ["rev-parse", "--git-path", name]);
    if (out.code !== 0) return false;
    const path = out.stdout.trim();
    return existsSync(path.startsWith("/") ? path : join(cwd, path));
  });
}
/** The branch a rebase in progress at `cwd` is rebasing; null for a detached one or none. */
export function rebasingBranch(cwd: string): string | null {
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const path = git(cwd, ["rev-parse", "--git-path", `${dir}/head-name`]).stdout.trim(),
      file = path && resolve(cwd, path);
    if (!file || !existsSync(file)) continue;
    const ref = readFileSync(file, "utf8").trim();
    return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
  }
  return null;
}
/** The commit a stopped rebase is replaying, as `<sha>` and `<short sha> <subject>`. */
export function rebaseStoppedAt(cwd: string): { commit: string; line: string } | null {
  const commit = revParse(cwd, "REBASE_HEAD");
  return commit ? { commit, line: must(cwd, ["log", "-1", "--format=%h %s", commit]) } : null;
}
/** The host an SSH alias stands for (`Host` entries in the SSH config), else the alias. */
export function sshHostname(alias: string): string {
  let p;
  try {
    p = Bun.spawnSync(["ssh", "-G", alias], { stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 5000 });
  } catch {
    return alias;
  }
  stopIfInterrupted(p);
  const line = p.exitCode === 0 ? p.stdout.toString().split("\n").find(l => l.startsWith("hostname ")) : null;
  return line ? line.slice("hostname ".length).trim().toLowerCase() : alias;
}
