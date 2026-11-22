import type { Context } from "../../core/context";
import { listOf, upstreamRemote } from "../../core/context";
import { Explained } from "../../core/errors";
import * as git from "../../git/git";
import { commandsOf, loadTrust, readRepoRecipe, recordTrust, repoRecipePath } from "../../recipes/trust";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

/** `debaser trust` (FR-042): shows the project-repo recipe's commands at the
 * fetched upstream tip and records its fingerprint after confirmation. */
export async function run(ctx: Context, _o: Options, io: IO): Promise<Outcome> {
  const list = listOf(ctx),
    remote = upstreamRemote(ctx),
    failed = git.fetch(ctx.repo, remote, `+refs/heads/${list.upstream.branch}:refs/remotes/${remote}/${list.upstream.branch}`),
    tip = git.revParse(ctx.repo, `refs/remotes/${remote}/${list.upstream.branch}`);
  if (failed && !tip) throw new Explained(`cannot fetch ${remote} ${list.upstream.branch}: ${failed}`);
  const found = tip ? readRepoRecipe(ctx.repo, tip) : null;
  if (!found) return { code: 0, lines: [`debaser: ${list.upstream.repo} has no ${repoRecipePath} at ${tip?.slice(0, 7) ?? "its tip"}; nothing to trust`] };
  if (loadTrust(ctx.dir).trusted[list.upstream.repo]?.sha256 === found.sha256)
    return { code: 0, lines: [`debaser: ${repoRecipePath} at ${tip!.slice(0, 7)} is already trusted`] };
  const shown = commandsOf(found.recipe).map(c => `  ${c}`);
  if (!io.ask) throw new Explained("trusting a recipe needs a terminal to confirm on", ["  or pass --trust-recipe to build"]);
  const answer = io.ask([`${repoRecipePath} at ${tip!.slice(0, 7)} runs:`, ...shown, "Trust it? [y/N] "].join("\n"));
  if (!/^y(es)?$/i.test(answer?.trim() ?? "")) throw new Explained(`${repoRecipePath} was not trusted`);
  recordTrust(ctx, found.sha256);
  return { code: 0, lines: [`debaser: trusted ${repoRecipePath} at ${tip!.slice(0, 7)} (sha256 ${found.sha256.slice(0, 12)})`] };
}
