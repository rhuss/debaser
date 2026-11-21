import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import * as git from "../git/git";
import { remoteTarget, repositoryOf, sameRepository } from "../git/remotes";

/** Why own branches can't be rebased or pushed: no origin, or origin pushes to
 * upstream (compared by repository, however the URLs are spelled). */
export function forkProblem(ctx: Context): string | null {
  const list = listOf(ctx);
  if (!git.hasRemote(ctx.repo, "origin")) return "there is no origin remote";
  // `git push origin` pushes to every push URL: none of them may be upstream.
  const pushes = git
      .git(ctx.repo, ["remote", "get-url", "--push", "--all", "origin"])
      .stdout.split("\n")
      .filter(Boolean)
      .map(repositoryOf),
    remote = upstreamRemote(ctx),
    upstream = git.hasRemote(ctx.repo, remote) && remote !== "origin" ? remoteTarget(ctx.repo, remote, "fetch") : null;
  if (pushes.some(push => (upstream && push === upstream) || sameRepository(list.upstream.repo, push))) return "origin pushes to upstream";
  return null;
}
