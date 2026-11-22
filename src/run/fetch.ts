import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import { Explained } from "../core/errors";
import type { Patch } from "../core/patchlist";
import type { Planned, RunState } from "../core/runstate";
import * as git from "../git/git";
import { pushUrl } from "../git/remotes";
import { display, fetchSource, githubBase, link } from "../plugins/sources/parse";
import { event } from "./common";

/** Fetches one patch into a private ref (or picks the own branch's copy) and
 * decides whether to merge it (FR-005, FR-007, FR-053). */
export function fetchPatch(ctx: Context, patch: Patch, run: RunState): Planned {
  const list = listOf(ctx),
    shown = display(patch.source);
  let fetched;
  try {
    fetched = fetchSource(patch.source, {
      repo: ctx.repo,
      env: ctx.env,
      upstream: { ...list.upstream, remote: upstreamRemote(ctx), tip: run.upstream.tip },
    });
  } catch (error) {
    // A pinned patch needs only its commit (FR-053): a source that is gone
    // (a deleted branch, an unreachable PR) doesn't stop it.
    if (!patch.pin) throw new Explained((error as Error).message, ["  nothing was reset; fix the source or remove the patch, then build"]);
    fetched = { commit: patch.pin, ref: patch.pin, notes: [`warning: ${(error as Error).message}; using the pinned commit`] };
  }
  for (const note of fetched.notes)
    if (note.startsWith("warning: ")) event(run, "warning", { patch: shown, detail: note.slice("warning: ".length) });
    else event(run, "note", { patch: shown, detail: note });
  const planned: Planned = {
    source: patch.source,
    display: shown,
    description: patch.description,
    commit: fetched.commit,
    ref: fetched.ref,
    prLink: link(patch.source),
    ...(fetched.pr ? { prState: fetched.pr.state, prBody: fetched.pr.body ?? "" } : {}),
    ...(patch.pin ? { pin: patch.pin } : {}),
    ...(patch.acceptance ? { acceptance: patch.acceptance } : {}),
    skip: null,
  };
  if (patch.pin) {
    // A pinned patch merges exactly its commit, fetched by its id when the source's tip moved past it.
    if (!git.revParse(ctx.repo, patch.pin)) {
      const s = patch.source,
        from =
          s.kind === "branch"
            ? git.hasRemote(ctx.repo, "origin")
              ? (pushUrl(ctx.repo) ?? "origin")
              : null
            : s.kind === "pr"
              ? s.repo.toLowerCase() === list.upstream.repo.toLowerCase()
                ? upstreamRemote(ctx)
                : `${githubBase(ctx.env)}/${s.repo}.git`
              : (s.url ?? `${githubBase(ctx.env)}/${s.repo}.git`);
      if (from) git.fetch(ctx.repo, from, patch.pin);
    }
    if (!git.revParse(ctx.repo, patch.pin)) throw new Explained(`cannot find the pinned commit ${patch.pin} of ${shown}`);
    planned.commit = git.revParse(ctx.repo, patch.pin);
  }
  const s = patch.source;
  if (s.kind === "pr" && fetched.pr) {
    // MERGED on another repository means merged there, not upstream; on upstream it
    // counts once the fetched branch has the merge.
    const mergedUpstream = s.repo.toLowerCase() === list.upstream.repo.toLowerCase() && fetched.pr.state === "MERGED",
      // A pinned patch merges its own commit: only whether upstream contains that commit counts.
      intoUpstream = !patch.pin && mergedUpstream && !!fetched.pr.mergeCommit && git.isAncestor(ctx.repo, fetched.pr.mergeCommit, run.upstream.tip);
    if (intoUpstream) planned.skip = "merged";
    else if (mergedUpstream && !git.isAncestor(ctx.repo, planned.commit!, run.upstream.tip))
      event(run, "note", {
        patch: shown,
        detail: patch.pin
          ? `the PR is merged; ${list.upstream.branch} doesn't contain the pinned commit, so merging it`
          : `the PR is merged, but not into the fetched ${list.upstream.branch}; merging it`,
      });
    else if (fetched.pr.state === "CLOSED")
      event(run, "closed-warning", { patch: shown, detail: "the PR was closed without merging" });
  }
  if (!planned.skip && git.isAncestor(ctx.repo, planned.commit!, run.upstream.tip)) planned.skip = s.kind === "pr" ? "merged" : "contained";
  return planned;
}
