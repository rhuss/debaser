import type { Context } from "../../core/context";
import { listOf } from "../../core/context";
import { Usage } from "../../core/errors";
import { rebaseCommand } from "../../run/rebase-phase";
import { resume } from "../../run/resume";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

export async function run(ctx: Context, o: Options, _io: IO): Promise<Outcome> {
  listOf(ctx);
  ctx.trustRecipe = o.trustRecipe;
  // `rebase --skip-branch` is kept as a spelling of `continue --skip-branch`.
  if (o.skipBranch) return resume(ctx, { skipBranch: true });
  if (o.rebase === "off") throw new Usage("--rebase off rebases nothing; use all or conflicting");
  return rebaseCommand(ctx, { rebase: o.rebase, push: o.push, inWorktree: o.inWorktree });
}
