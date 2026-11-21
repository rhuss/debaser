import type { Context } from "../../core/context";
import { listOf } from "../../core/context";
import { resume } from "../../run/resume";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

export async function run(ctx: Context, o: Options, _io: IO): Promise<Outcome> {
  listOf(ctx);
  ctx.trustRecipe = o.trustRecipe;
  return resume(ctx, { skipBranch: o.skipBranch });
}
