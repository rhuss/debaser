import { git, type Output } from "./git";

/** The repository a remote fetches from or pushes to, as `host/path` without
 * scheme, user, port, `.git` or case, so two spellings of one repository compare equal. */
export function remoteTarget(cwd: string, name: string, direction: "fetch" | "push"): string {
  return repositoryOf(git(cwd, ["remote", "get-url", ...(direction === "push" ? ["--push"] : []), name]).stdout);
}
/** The URL `origin` (or `name`) pushes to: the first push URL, else the fetch URL. */
export function pushUrl(cwd: string, name = "origin"): string | null {
  const out = git(cwd, ["remote", "get-url", "--push", name]);
  return out.code === 0 ? out.stdout.split("\n")[0].trim() || null : null;
}
/** A remote URL as `host/path` (a path for a local one), lowercased, without
 * scheme, user, port, `.git` or trailing slashes. Only a URL with a scheme
 * has a port; in `user@host:1234/repo` the digits are the owner. */
export function repositoryOf(url: string): string {
  const u = url.trim().split("\n")[0].trim();
  let where = u;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(u),
    scp = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(u);
  if (/^file:\/\//i.test(u)) where = u.slice("file://".length);
  else if (scheme) where = `${scheme[1]}/${scheme[2].replace(/^\/+/, "")}`;
  else if (scp) where = `${scp[1]}/${scp[2].replace(/^\/+/, "")}`;
  return where
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}
/** Whether `repo` (`owner/name`) is the repository at `target` (a `repositoryOf`
 * result, `host/owner/name` or a local path): their last two parts match. */
export function sameRepository(repo: string, target: string): boolean {
  const tail = (path: string) => path.toLowerCase().replace(/\.git$/, "").split("/").filter(Boolean).slice(-2).join("/");
  return tail(repo) !== "" && tail(repo) === tail(target);
}
/** The commit `ref` points at on `remote` (a name or URL): "" when it doesn't
 * exist there; the error text when the remote can't be read. */
export function remoteTip(cwd: string, remote: string, ref: string): { tip: string } | { error: string } {
  const out = git(cwd, ["ls-remote", "--refs", remote, ref]);
  if (out.code !== 0) return { error: (out.stderr || out.stdout).trim() || "ls-remote failed" };
  // ls-remote matches by tail; only the exact ref counts.
  const line = out.stdout
    .split("\n")
    .map(l => l.split("\t"))
    .find(([, name]) => name?.trim() === ref);
  return { tip: line?.[0].trim() ?? "" };
}
/** Pushes `commit` to `branch` on `remote`, only while the remote branch is still at `lease` ("" = absent). */
export function pushWithLease(cwd: string, remote: string, branch: string, commit: string, lease: string): Output {
  return git(cwd, ["push", "--quiet", `--force-with-lease=refs/heads/${branch}:${lease}`, remote, `${commit}:refs/heads/${branch}`]);
}
