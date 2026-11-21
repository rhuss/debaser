import type { Context } from "../../core/context";
import { listOf } from "../../core/context";
import { Explained } from "../../core/errors";
import * as patchlist from "../../core/patchlist";
import { display, sameSource } from "../../plugins/sources/parse";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import { named } from "./add";
import type { Options } from "./index";

/** Moves a patch to the retired list with today's date and a reason (FR-003). */
export async function run(ctx: Context, o: Options, io: IO): Promise<Outcome> {
  const list = listOf(ctx),
    named_ = named(ctx, o.positional[0], list.upstream.repo),
    // The same source however it is spelled (URL form, repository case), as `add` compares.
    index = list.patches.findIndex(p => sameSource(p.source, named_.source));
  if (index < 0) throw new Explained(`${named_.shown} is not in the list`);
  const shown = display(list.patches[index].source);
  let reason = o.reason;
  if (!reason) reason = io.ask?.(`Why is ${shown} retired? `)?.trim() ?? null;
  if (!reason) throw new Explained(`removing ${shown} needs --reason`);
  const [patch] = list.patches.splice(index, 1);
  list.retired.push({ ...patch, retired: ctx.now().toISOString().slice(0, 10), reason });
  patchlist.save(ctx.dir, list);
  return { code: 0, lines: [`retired ${shown}: ${reason}`] };
}
