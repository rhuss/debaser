import type { Context } from "../../core/context";
import { listOf } from "../../core/context";
import { Explained, Usage } from "../../core/errors";
import { moveTo, place, resolveRef, sameOrder } from "../../core/order";
import * as patchlist from "../../core/patchlist";
import { computeProposal } from "../../run/propose";
import { refuseWhileRunning } from "../../run/where";
import { render } from "../../views/propose";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";
import { ordered } from "./list";

/** The option combinations `move` takes (FR-006). */
function checkOptions(o: Options): void {
  const ref = o.positional[0] ?? null,
    placed = o.after !== null || o.before !== null;
  if (o.propose) {
    if (ref !== null || placed) throw new Usage("--propose takes no patch, --after or --before");
    return;
  }
  if (o.yes || o.fetch) throw new Usage("--yes and --fetch go with --propose");
  if (o.after !== null && o.before !== null) throw new Usage("--after and --before can't be used together");
  if (ref !== null && !placed) throw new Usage(`move ${ref} needs --after <patch> or --before <patch>`);
  if (ref === null && placed) throw new Usage("name the patch to move: move <patch> --after|--before <patch>");
}

/** `debaser move`: reorders the patch list from the command line, through
 * line prompts, or by a proposal (spec 003). It never resolves conflicts,
 * calls the harness, pushes or builds (FR-025). */
export async function run(ctx: Context, o: Options, io: IO): Promise<Outcome> {
  checkOptions(o);
  // `main` holds the run lock and read the list under it, until the list is written (FR-023).
  const list = listOf(ctx);
  // Every form refuses before any prompt or merge test (FR-022).
  refuseWhileRunning(ctx);
  if (list.patches.length < 2) return { code: 0, lines: ["nothing to reorder"] };
  const ref = (arg: string) => resolveRef(list.patches, arg, list.upstream.repo);
  if (o.propose) return proposed(ctx, o, io);
  if (o.positional[0] === undefined) return interactive(ctx, io);
  const from = ref(o.positional[0]),
    moved = list.patches[from],
    next = place(list.patches, from, o.after !== null ? { after: ref(o.after) } : { before: ref(o.before!) });
  if (sameOrder(next, list.patches)) return { code: 0, lines: ["the order is unchanged"] };
  list.patches = next;
  patchlist.save(ctx.dir, list);
  return { code: 0, lines: ordered(ctx, io, [next.indexOf(moved)]) };
}

/** Plain `move` on a terminal (FR-009 to FR-012): numbered prompts on a copy
 * of the list, saved once at the end when the order changed. */
async function interactive(ctx: Context, io: IO): Promise<Outcome> {
  const ask = ctx.line;
  if (!ask)
    throw new Usage("move without a patch needs a terminal; use move <patch> --after|--before <patch> or move --propose");
  const list = listOf(ctx),
    n = list.patches.length,
    show = (lines: string[]) => io.out(lines.join("\n") + "\n"),
    // The end of input ends the session before it saved anything.
    answer = async (question: string) => {
      const text = await ask(question);
      if (text === null) throw new Explained("the input ended; the patch list is unchanged");
      return text.trim();
    },
    // A number from 1 to n, asked again until it is one; null for Enter when `optional`.
    number = async (question: string, optional: boolean): Promise<number | null> => {
      for (;;) {
        const text = await answer(question);
        if (!text && optional) return null;
        if (/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= n) return Number(text);
        show([`answer a number from 1 to ${n}`]);
      }
    };
  let patches = list.patches;
  show(ordered(ctx, io, []));
  for (;;) {
    const from = await number(`Move which patch? (1-${n}, Enter to finish) `, true);
    if (from === null) break;
    const to = (await number(`To which position? (1-${n}) `, false))!;
    patches = moveTo(patches, from - 1, to - 1);
    show(ordered(ctx, io, [to - 1], patches));
    if (!/^y(es)?$/i.test(await answer("Move another patch? [y/N] "))) break;
  }
  if (sameOrder(patches, list.patches)) return { code: 0, lines: ["the order is unchanged"] };
  list.patches = patches;
  patchlist.save(ctx.dir, list);
  return { code: 0, lines: ["saved the new order"] };
}

/** `move --propose` (FR-013 to FR-021): shows a conflict-reducing order and
 * applies it on yes, or with `--yes`; it never starts a build (FR-018).
 * `compute` is the proposal's git work, replaceable in tests. */
export async function proposed(ctx: Context, o: Pick<Options, "fetch" | "yes">, io: IO, compute = computeProposal): Promise<Outcome> {
  const { proposal: p, names } = compute(ctx, { fetch: o.fetch }),
    shown = render(p, names, { color: !!io.color }),
    moved = p.proposed.flatMap((index, at) => (index === p.current[at] ? [] : [at]));
  if (p.kept)
    return { code: 0, lines: [...shown, "", "the proposed order merges with more conflicts than the current one; the current order stays"] };
  if (!moved.length) return { code: 0, lines: [...shown, "", "the current order is already the best order found"] };
  let lines = [...shown, ""];
  if (!o.yes) {
    if (!ctx.line) return { code: 0, lines: [...lines, "run debaser move --propose --yes to apply it"] };
    io.out(lines.join("\n") + "\n");
    lines = [];
    if (!/^y(es)?$/i.test((await ctx.line("Apply this order? [y/N] "))?.trim() ?? "")) return { code: 0, lines: ["the order is unchanged"] };
  }
  const list = listOf(ctx);
  list.patches = p.proposed.map(index => list.patches[index]);
  patchlist.save(ctx.dir, list);
  return { code: 0, lines: [...lines, ...ordered(ctx, io, moved), "", "next: debaser build"] };
}
