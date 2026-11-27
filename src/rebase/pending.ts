import * as git from "../git/git";
import { refs } from "../git/refs";

/** Rebased by an earlier run whose push is still due: the branch still holds
 * that rebase, and the fork is where it was then. The rebase phase and the
 * branch source both use it, so a pending push is never called a divergence. */
export function pushPending(repo: string, branch: string, local: string | null, pushed: string | null): boolean {
  const rebased = git.revParse(repo, refs.rebased(branch));
  return (
    !!rebased &&
    !!local &&
    local !== pushed &&
    git.isAncestor(repo, rebased, local) &&
    (git.revParse(repo, refs.rebaseLease(branch)) ?? "") === (pushed ?? "")
  );
}
