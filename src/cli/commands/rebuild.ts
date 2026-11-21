import type { Context } from "../../core/context";
import { listOf } from "../../core/context";
import { rebuild } from "../../run/rebuild";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

export async function run(ctx: Context, o: Options, _io: IO): Promise<Outcome> {
  listOf(ctx);
  ctx.trustRecipe = o.trustRecipe;
  return rebuild(ctx, { push: o.push, rebase: o.rebase, inWorktree: o.inWorktree });
}
