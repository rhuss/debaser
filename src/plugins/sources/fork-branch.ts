import * as git from "../../git/git";
import { refs } from "../../git/refs";
import { repositoryOf } from "../../git/remotes";
import { branchPath, githubBase, repoName, slug } from "./github";
import type { FetchContext, FetchedPatch, ForkBranchSource, SourceKind } from "./types";

/** Why a fork URL can't be used: credentials in it would end up in the patch
 * list, reports, handoffs, commit messages and prompts. Null when it is fine. */
export function urlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.password || (/^https?:$/.test(parsed.protocol) && parsed.username))
    return `${parsed.protocol}//${parsed.host}${parsed.pathname} carries credentials; drop them from the URL and use a git credential helper`;
  return null;
}

const where = (s: ForkBranchSource) => s.repo ?? slug(s.url ?? "");

/** A branch of another repository, by `owner/repo` on GitHub or by any git URL. */
export const forkBranch: SourceKind<ForkBranchSource> = {
  kind: "fork-branch",
  parse(text) {
    let m: RegExpMatchArray | null;
    if ((m = text.match(new RegExp(`^https://github\\.com/(${repoName})/tree/(.+?)/?$`))))
      return { kind: "fork-branch", repo: m[1], branch: m[2] };
    if ((m = text.match(/^(.+)#branch=(.+)$/))) return { kind: "fork-branch", url: m[1], branch: m[2] };
    if ((m = text.match(new RegExp(`^(${repoName}):(.+)$`)))) return { kind: "fork-branch", repo: m[1], branch: m[2] };
    return null;
  },
  display: s => `${s.repo ?? s.url}:${s.branch}`,
  slug: s => slug(`${s.repo ?? s.url}:${s.branch}`),
  privateRef: s => refs.forkHead(where(s), s.branch),
  link: s => (s.repo ? `https://github.com/${s.repo}/tree/${branchPath(s.branch)}` : null),
  headRepository: s => s.repo ?? (s.url ? repositoryOf(s.url) : null),
  fetch(s, ctx: FetchContext): FetchedPatch {
    const ref = refs.forkHead(where(s), s.branch),
      from = s.url ?? `${githubBase(ctx.env)}/${s.repo}.git`,
      failed = git.fetch(ctx.repo, from, `+refs/heads/${s.branch}:${ref}`);
    if (failed) throw Error(`cannot fetch ${forkBranch.display(s)}: ${failed}`);
    return { commit: git.revParse(ctx.repo, ref)!, ref, notes: [] };
  },
};
