import type { Context } from "../../core/context";
import { listOf, upstreamRemote } from "../../core/context";
import * as git from "../../git/git";
import { remoteTarget } from "../../git/remotes";
import { display } from "../../plugins/sources/parse";
import { render } from "../../views/list";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

export async function run(ctx: Context, o: Options, io: IO): Promise<Outcome> {
  const list = listOf(ctx),
    // Own branches link into the fork; only a terminal shows links.
    fork = io.color && git.hasRemote(ctx.repo, "origin") ? remoteTarget(ctx.repo, "origin", "push") : null;
  return {
    code: 0,
    lines: render(list, { retired: o.retired, verbose: o.verbose, upstream: `${upstreamRemote(ctx)}/${list.upstream.branch}`, fork, color: !!io.color, columns: io.columns }),
    json: {
      upstream: list.upstream,
      branch: list.branch,
      patches: list.patches.map(p => ({ ...p, display: display(p.source), hasCheck: !!p.acceptance })),
      retired: list.retired.map(p => ({ ...p, display: display(p.source) })),
    },
  };
}
