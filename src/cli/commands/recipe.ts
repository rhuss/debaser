import type { Context } from "../../core/context";
import { listOf, upstreamRemote } from "../../core/context";
import * as git from "../../git/git";
import { loadRecipe } from "../../recipes/load";
import { loadTrust, readRepoRecipe, repoRecipePath } from "../../recipes/trust";
import { render } from "../../views/recipe";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

/** `debaser recipe` (FR-044): the effective recipe and the layer of each value. */
export async function run(ctx: Context, o: Options, io: IO): Promise<Outcome> {
  const list = listOf(ctx),
    tip = git.revParse(ctx.repo, `refs/remotes/${upstreamRemote(ctx)}/${list.upstream.branch}`);
  ctx.trustRecipe = false;
  // Read only: an untrusted project recipe is shown as such, never asked about.
  const r = loadRecipe(ctx, tip, { peek: true }),
    repo = tip ? readRepoRecipe(ctx.repo, tip) : null,
    untrusted = repo && loadTrust(ctx.dir).trusted[list.upstream.repo]?.sha256 !== repo.sha256,
    note = untrusted ? `${repoRecipePath} at ${tip!.slice(0, 7)} is not trusted and not used; \`debaser trust\` reviews it` : null;
  return {
    code: 0,
    lines: render(r, { color: !!io.color, note }),
    json: {
      layers: r.layers,
      generic: r.generic,
      projectName: r.projectName,
      steps: r.steps.map(s => ({ ...s, layer: r.provenance[`steps.${s.name}`] })),
      install: r.install ?? null,
      artifact: r.artifact ?? null,
      afterBuild: r.afterBuild ?? null,
      leftovers: r.leftovers,
      prompts: Object.fromEntries(Object.keys(r.prompts).map(k => [k, r.provenance[`prompts.${k}`]])),
      provenance: r.provenance,
      untrustedRepoRecipe: untrusted ? repoRecipePath : null,
    },
  };
}
