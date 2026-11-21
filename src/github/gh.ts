import { stopIfInterrupted } from "../git/git";

export type PrState = "OPEN" | "CLOSED" | "MERGED";
/** `head`: the repository (`owner/name`) and branch the PR is opened from. */
export type PrInfo = {
  state: PrState;
  title: string;
  body: string;
  url: string;
  mergeCommit: string | null;
  head: { repo: string; branch: string } | null;
};

/** A PR's state, title, body, merge commit and head from the GitHub CLI; null
 * without `gh` or when it can't answer (not signed in, offline, no such PR). */
export function prInfo(repo: string, number: number, env: Record<string, string | undefined> = process.env): PrInfo | null {
  const gh = Bun.which("gh", { PATH: env.PATH ?? "" });
  if (!gh) return null;
  // Asked once per command: status and rebuild ask about the same PR from several places.
  const key = `${gh}\0${repo.toLowerCase()}#${number}`;
  if (answers.has(key)) return answers.get(key)!;
  const info = askGh(gh, repo, number, env);
  answers.set(key, info);
  return info;
}
const answers = new Map<string, PrInfo | null>();
/** Forgets the PR answers, at the start of each command. */
export function forgetPrInfo(): void {
  answers.clear();
}
function askGh(gh: string, repo: string, number: number, env: Record<string, string | undefined>): PrInfo | null {
  let p;
  try {
    p = Bun.spawnSync(
      [gh, "pr", "view", String(number), "--repo", repo, "--json", "state,title,body,mergeCommit,headRepositoryOwner,headRepository,headRefName,url"],
      // Bounded and never prompting: an offline or stalled gh doesn't hang the run.
      { env: { GH_PROMPT_DISABLED: "1", ...env }, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 60_000, killSignal: "SIGKILL" },
    );
  } catch {
    return null;
  }
  stopIfInterrupted(p);
  if (p.exitCode !== 0) return null;
  try {
    const raw = JSON.parse(p.stdout.toString()) as Record<string, unknown>,
      state = String(raw.state ?? "").toUpperCase(),
      merge = raw.mergeCommit as { oid?: unknown } | null | undefined,
      owner = (raw.headRepositoryOwner as { login?: unknown } | null | undefined)?.login,
      name = (raw.headRepository as { name?: unknown } | null | undefined)?.name,
      branch = raw.headRefName;
    if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") return null;
    return {
      state,
      title: typeof raw.title === "string" ? raw.title : "",
      body: typeof raw.body === "string" ? raw.body : "",
      url: typeof raw.url === "string" ? raw.url : `https://github.com/${repo}/pull/${number}`,
      mergeCommit: typeof merge?.oid === "string" ? merge.oid : null,
      head:
        typeof owner === "string" && typeof name === "string" && typeof branch === "string" && branch
          ? { repo: `${owner}/${name}`, branch }
          : null,
    };
  } catch {
    return null;
  }
}

/** A PR title as a description, without a leading `area: `. */
export function stripArea(title: string): string {
  return title.replace(/^[\w./-]+:\s+/, "").trim();
}
