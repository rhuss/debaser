import * as git from "../../git/git";
import { refs } from "../../git/refs";
import { prInfo } from "../../github/gh";
import { githubBase, repoName, slug } from "./github";
import type { FetchContext, FetchedPatch, PrSource, SourceKind } from "./types";

/** A pull request on upstream or any other GitHub repository. */
export const pr: SourceKind<PrSource> = {
  kind: "pr",
  parse(text, ctx) {
    let m: RegExpMatchArray | null;
    if ((m = text.match(/^#?(\d+)$/))) return { kind: "pr", repo: ctx.upstreamRepo, number: Number(m[1]) };
    if ((m = text.match(new RegExp(`^https://github\\.com/(${repoName})/pull/(\\d+)/?$`))))
      return { kind: "pr", repo: m[1], number: Number(m[2]) };
    if ((m = text.match(new RegExp(`^(${repoName})#(\\d+)$`)))) return { kind: "pr", repo: m[1], number: Number(m[2]) };
    return null;
  },
  display: s => `${s.repo}#${s.number}`,
  slug: s => slug(`${s.repo}#${s.number}`),
  privateRef: s => refs.pull(s.repo, s.number),
  link: s => `https://github.com/${s.repo}/pull/${s.number}`,
  headRepository(s, ctx) {
    return prInfo(s.repo, s.number, ctx.env)?.head?.repo ?? null;
  },
  fetch(s, ctx: FetchContext): FetchedPatch {
    const ref = refs.pull(s.repo, s.number),
      from = s.repo.toLowerCase() === ctx.upstream.repo.toLowerCase() ? ctx.upstream.remote : `${githubBase(ctx.env)}/${s.repo}.git`,
      failed = git.fetch(ctx.repo, from, `+refs/pull/${s.number}/head:${ref}`);
    if (failed) throw Error(`cannot fetch ${s.repo}#${s.number}: ${failed}`);
    const info = prInfo(s.repo, s.number, ctx.env);
    return {
      commit: git.revParse(ctx.repo, ref)!,
      ref,
      // Without gh the PR's state is unknown: a PR merged by squash or rebase is merged again.
      notes: info ? [] : ["warning: gh could not tell the PR's state (is gh installed and signed in?); it is merged unless upstream already has its commits"],
      ...(info
        ? {
            pr: {
              state: info.state,
              title: info.title,
              ...(info.mergeCommit ? { mergeCommit: info.mergeCommit } : {}),
              url: info.url,
              body: info.body,
            },
          }
        : {}),
    };
  },
};
