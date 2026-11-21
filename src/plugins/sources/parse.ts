import { repositoryOf } from "../../git/remotes";
import { names, get, of } from "./registry";
import type { FetchContext, FetchedPatch, ParseContext, Source } from "./types";

export { urlProblem } from "./fork-branch";
export { slug, githubBase } from "./github";

/** The source an `add` argument names (`#123`, `owner/repo#12`, `owner/repo:branch`,
 * a GitHub pull or tree URL, `<git url>#branch=<name>`, or a branch name). */
export function parse(arg: string, upstreamRepo: string): Source {
  const text = arg.trim(),
    ctx: ParseContext = { upstreamRepo };
  for (const name of names()) {
    const s = get(name as Source["kind"]).parse(text, ctx);
    if (s) return s;
  }
  throw Error(`cannot read ${arg} as a patch source`);
}
/** A source's name everywhere it is shown, and its identity in the patch list. */
export const display = (s: Source): string => of(s).display(s);
export const privateRef = (s: Source): string | null => of(s).privateRef(s);
export const link = (s: Source): string | null => of(s).link(s);
export const fetchSource = (s: Source, ctx: FetchContext): FetchedPatch => of(s).fetch(s, ctx);
/** One source's identity however it is spelled: `owner/repo` by repository
 * case-insensitively, a fork branch by its repository and branch. */
export function sourceKey(s: Source): string {
  switch (s.kind) {
    case "branch":
      return `branch:${s.name}`;
    case "pr":
      return `pr:${s.repo.toLowerCase()}#${s.number}`;
    case "fork-branch":
      return `fork:${repositoryOf(s.url ?? `github.com/${s.repo}`).split("/").slice(-2).join("/")}:${s.branch}`;
  }
}
export const sameSource = (a: Source, b: Source) => sourceKey(a) === sourceKey(b);
