import * as git from "../../git/git";
import { refs } from "../../git/refs";
import { pushUrl } from "../../git/remotes";
import { slug } from "./github";
import type { BranchSource, FetchContext, FetchedPatch, SourceKind } from "./types";

/** An own branch of this repository. The copy merged is the local branch, or
 * origin's when the local one is behind it (FR-031a). */
export const branch: SourceKind<BranchSource> = {
  kind: "branch",
  parse: text => (text.trim() ? { kind: "branch", name: text.trim() } : null),
  display: s => s.name,
  slug: s => slug(s.name),
  privateRef: () => null,
  link: () => null,
  headRepository: () => null,
  fetch(s, ctx: FetchContext): FetchedPatch {
    const { repo } = ctx,
      notes: string[] = [],
      local = git.revParse(repo, `refs/heads/${s.name}`),
      // The pushed copy lives where origin pushes to: when origin fetches from
      // elsewhere (upstream), it is read from the push URL into debaser's fork ref.
      origin = git.hasRemote(repo, "origin"),
      push = origin ? pushUrl(repo) : null,
      tracked = !push || git.git(repo, ["remote", "get-url", "origin"]).stdout.trim() === push,
      copy = tracked ? `refs/remotes/origin/${s.name}` : refs.fork(s.name),
      failed = origin ? git.fetch(repo, tracked ? "origin" : push!, `+refs/heads/${s.name}:${copy}`) : null,
      stale = git.revParse(repo, copy),
      // An unfetched origin copy may be old or deleted, so only a fresh fetch counts.
      pushed = failed ? null : stale;
    if (failed && !local) {
      if (stale)
        throw Error(
          `cannot fetch origin/${s.name} for ${s.name}, and there is no local branch: only a stale copy of origin/${s.name} is known; fetch it or create the local branch`,
        );
      throw Error(`cannot fetch origin/${s.name} for ${s.name}: ${failed}`);
    }
    if (failed && stale) notes.push(`could not fetch origin/${s.name}; using the local branch`);
    if (!local && !pushed) throw Error(`cannot find ${s.name}: no such local branch or origin/${s.name}`);
    if (!local) {
      notes.push(`no local branch; using origin/${s.name}`);
      return { commit: pushed!, ref: copy, notes };
    }
    if (pushed && pushed !== local) {
      if (git.isAncestor(repo, local, pushed)) {
        notes.push(`local branch is behind origin/${s.name}; using origin/${s.name}`);
        return { commit: pushed, ref: copy, notes };
      }
      if (!git.isAncestor(repo, pushed, local))
        notes.push(`warning: local branch and origin/${s.name} have diverged; using the local branch`);
    }
    return { commit: local, ref: `refs/heads/${s.name}`, notes };
  },
};
