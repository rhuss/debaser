import { Explained } from "../core/errors";

export type Output = { code: number; stdout: string; stderr: string };
/** Merges, and the commits that conclude them, record and replay resolutions. */
export const rerereFlags = ["-c", "rerere.enabled=true", "-c", "rerere.autoUpdate=true"];

const interruptions = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
/** Cleanups to run before the process ends on an interruption (the run lock, the live view). */
const cleanups = new Set<() => void>();
export function onInterrupt(cleanup: () => void): () => void {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}
/** Ends the process with `code` after the interruption cleanups. The run state
 * stays where it is, so `continue` or `rollback` can handle it. */
export function interrupt(code: number): never {
  // Newest first, like nested `finally` blocks: a step's processes end before
  // the worktree they run in goes, and the run lock is released last.
  for (const cleanup of [...cleanups].reverse()) {
    try {
      cleanup();
    } catch {}
  }
  process.exit(code);
}

/** Stops the process when a synchronous child was interrupted (Ctrl-C, a kill):
 * it died of SIGINT, SIGTERM or SIGHUP, or exited with 130 or 143, the codes a
 * shell gives for the first two. 129 by itself is git's code for a usage error,
 * so only the signal counts for SIGHUP. A timeout's kill is not an interruption. */
export function stopIfInterrupted(p: {
  exitCode: number | null;
  signalCode?: string | number | null;
  exitedDueToTimeout?: boolean;
}): void {
  if (p.exitedDueToTimeout) return;
  const bySignal = typeof p.signalCode === "string" ? interruptions[p.signalCode as keyof typeof interruptions] : undefined,
    byCode = [interruptions.SIGINT, interruptions.SIGTERM].find(code => code === p.exitCode),
    code = bySignal ?? byCode;
  if (code !== undefined) interrupt(code);
}

/** Commands that talk to a remote: bounded in time and never prompting, so an
 * unattended run can't hang on a stalled connection or a credential prompt. */
const network = new Set(["fetch", "push", "ls-remote"]);
export const networkTimeoutSeconds = 900;
/** git's own stall detection (below 1 KB/s for a minute) and no terminal prompts,
 * unless the user's environment already sets them. */
function networkEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { GIT_TERMINAL_PROMPT: "0", GIT_HTTP_LOW_SPEED_LIMIT: "1000", GIT_HTTP_LOW_SPEED_TIME: "60", ...env };
}

export function git(
  cwd: string,
  args: string[],
  o: { rerere?: boolean; env?: Record<string, string | undefined>; stdin?: string } = {},
): Output {
  const remote = network.has(args[0]),
    env = o.env ?? process.env;
  const p = Bun.spawnSync(["git", ...(o.rerere ? rerereFlags : []), ...args], {
    cwd,
    env: remote ? networkEnv(env) : env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: o.stdin === undefined ? "ignore" : new TextEncoder().encode(o.stdin),
    ...(remote ? { timeout: networkTimeoutSeconds * 1000, killSignal: "SIGKILL" as const } : {}),
  });
  stopIfInterrupted(p);
  if (p.exitedDueToTimeout)
    return { code: 1, stdout: p.stdout.toString(), stderr: `git ${args[0]} gave no result in ${networkTimeoutSeconds}s and was stopped` };
  return { code: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}
/** stdout of a git command that must succeed, trimmed. */
export function must(cwd: string, args: string[], o: { rerere?: boolean; env?: Record<string, string | undefined> } = {}): string {
  const out = git(cwd, args, o);
  if (out.code !== 0) throw Error(`git ${args[0]} failed: ${(out.stderr || out.stdout).trim()}`);
  return out.stdout.trim();
}
export const lines = (text: string) => text.split("\n").filter(Boolean);

export function repoRoot(cwd: string): string {
  const out = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (out.code !== 0) throw new Explained("not inside a git repository");
  return out.stdout.trim();
}
export function version(cwd: string): string {
  return must(cwd, ["--version"]).replace(/^git version /, "");
}
/** Refuses a git older than `minimum` (`merge-tree --write-tree` needs 2.38). */
export function requireVersion(cwd: string, minimum = "2.38", have = version(cwd)): void {
  const got = have.split(/[.\s]/).map(Number),
    want = minimum.split(".").map(Number);
  for (let i = 0; i < want.length; i++) {
    if ((got[i] ?? 0) > want[i]) return;
    if ((got[i] ?? 0) < want[i]) throw new Explained(`git ${minimum} or newer is required (found ${have})`);
  }
}
/** No changes to tracked files; untracked files don't count. */
export function isClean(cwd: string): boolean {
  return must(cwd, ["status", "--porcelain", "--untracked-files=no"]) === "";
}
export function currentBranch(cwd: string): string | null {
  const out = git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return out.code === 0 ? out.stdout.trim() : null;
}
export function revParse(cwd: string, ref: string): string | null {
  const out = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return out.code === 0 ? out.stdout.trim() : null;
}
export function head(cwd: string): string {
  return must(cwd, ["rev-parse", "HEAD"]);
}
export function isAncestor(cwd: string, a: string, b: string): boolean {
  return git(cwd, ["merge-base", "--is-ancestor", a, b]).code === 0;
}
export function hasRemote(cwd: string, name: string): boolean {
  return git(cwd, ["remote", "get-url", name]).code === 0;
}
export function branchExists(cwd: string, name: string): boolean {
  return revParse(cwd, `refs/heads/${name}`) !== null;
}
export function validBranchName(cwd: string, name: string): boolean {
  return git(cwd, ["check-ref-format", "--branch", name]).code === 0;
}
/** Fetches `refspec` from a URL or remote; the error text on failure. */
export function fetch(cwd: string, from: string, refspec: string): string | null {
  const out = git(cwd, ["fetch", "--quiet", "--no-tags", from, refspec]);
  return out.code === 0 ? null : (out.stderr || out.stdout).trim() || "fetch failed";
}
/** Updates `refs/remotes/<remote>/<branch>` and returns its commit. */
export function fetchRemote(cwd: string, remote: string, branch: string): string {
  const failed = fetch(cwd, remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`);
  if (failed) throw new Explained(`cannot fetch ${remote} ${branch}: ${failed}`);
  return revParse(cwd, `refs/remotes/${remote}/${branch}`)!;
}
/** The one-line `<short sha> <subject>` of a commit. */
export function oneLine(cwd: string, commit: string): string {
  return must(cwd, ["log", "-1", "--format=%h %s", commit]);
}
export function deleteRef(cwd: string, ref: string): void {
  git(cwd, ["update-ref", "-d", ref]);
}
/** Whether the index and the files match HEAD. */
export function matchesHead(cwd: string): boolean {
  return git(cwd, ["diff", "--quiet", "--cached", "HEAD"]).code === 0 && git(cwd, ["diff", "--quiet"]).code === 0;
}
