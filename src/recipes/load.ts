import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import * as git from "../git/git";
import { resolveRecipe } from "./resolve";
import { repoLayer } from "./trust";
import type { EffectiveRecipe } from "./types";
import { setLeftovers } from "../run/leftover";

/** Resolves the effective recipe for this checkout and sets it on the context.
 * With the upstream tip, generic detection and the project-repo recipe read
 * that commit (FR-042); without it, the last fetched upstream, else the checkout. */
export function loadRecipe(ctx: Context, tip?: string | null, o: { peek?: boolean; trustFlag?: boolean } = {}): EffectiveRecipe {
  const list = listOf(ctx),
    at = tip ?? git.revParse(ctx.repo, `refs/remotes/${upstreamRemote(ctx)}/${list.upstream.branch}`);
  ctx.recipe = resolveRecipe({
    checkout: ctx.repo,
    patchList: list,
    dir: ctx.dir,
    repoLayer: at ? repoLayer(ctx, at, o) : null,
    ...(at ? { exists: (path: string) => git.git(ctx.repo, ["cat-file", "-e", `${at}:${path}`]).code === 0 } : {}),
  });
  setLeftovers(ctx.recipe.leftovers);
  return ctx.recipe;
}
