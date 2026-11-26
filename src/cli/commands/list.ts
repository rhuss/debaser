import type { Context } from "../../core/context";
import { listOf, upstreamRemote } from "../../core/context";
import * as git from "../../git/git";
import { remoteTarget } from "../../git/remotes";
import { display } from "../../plugins/sources/parse";
import { configInfo } from "../../core/tree";
import { configHeader } from "../../views/config";
import { render } from "../../views/list";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

/** How `list` and the lists printed after a change render the live patches:
 * own branches link into the fork; only a terminal shows links. */
function shownAs(ctx: Context, io: IO) {
  return {
    upstream: `${upstreamRemote(ctx)}/${listOf(ctx).upstream.branch}`,
    fork: io.color && git.hasRemote(ctx.repo, "origin") ? remoteTarget(ctx.repo, "origin", "push") : null,
    color: !!io.color,
    columns: io.columns,
  };
}
/** The numbered live list (by default the saved one), with the patches at
 * the 0-based `marked` indices marked (spec 003, FR-004, FR-008). */
export function ordered(ctx: Context, io: IO, marked: number[], patches = listOf(ctx).patches): string[] {
  return render({ patches, retired: listOf(ctx).retired }, { ...shownAs(ctx, io), retired: false, marked: new Set(marked) });
}

export async function run(ctx: Context, o: Options, io: IO): Promise<Outcome> {
  const list = listOf(ctx),
    config = configInfo(ctx);
  return {
    code: 0,
    lines: [
      ...configHeader(config, { color: !!io.color, branch: list.branch, branchExists: git.branchExists(ctx.repo, list.branch) }),
      "",
      ...render(list, { ...shownAs(ctx, io), retired: o.retired, verbose: o.verbose }),
    ],
    json: {
      config,
      upstream: list.upstream,
      branch: list.branch,
      patches: list.patches.map(p => ({ ...p, display: display(p.source), hasCheck: !!p.acceptance })),
      retired: list.retired.map(p => ({ ...p, display: display(p.source) })),
    },
  };
}
