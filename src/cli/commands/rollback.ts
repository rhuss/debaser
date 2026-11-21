import type { Context } from "../../core/context";
import { listOf } from "../../core/context";
import { rollback } from "../../run/rollback";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

export async function run(ctx: Context, _o: Options, _io: IO): Promise<Outcome> {
  listOf(ctx);
  return rollback(ctx);
}
