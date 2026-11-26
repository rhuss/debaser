import type { Context } from "../../core/context";
import { Explained, Usage } from "../../core/errors";
import { end as liveEnd, type LiveEvent } from "../../live/events";
import { Live } from "../../live/live";
import { outcomeCard } from "../../live/render";
import { TaskView } from "../../live/task-view";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import { flag, option } from "../args";
import { rebaseModes, type RebaseMode } from "../../core/patchlist";
import * as add from "./add";
import * as remove from "./remove";
import * as move from "./move";
import * as list from "./list";
import * as build from "./build";
import * as rebase from "./rebase";
import * as resume from "./continue";
import * as rollback from "./rollback";
import * as status from "./status";
import * as recipe from "./recipe";
import * as trust from "./trust";

export type Options = {
  positional: string[];
  push: boolean;
  rebase?: RebaseMode;
  inWorktree: boolean;
  verbose: boolean;
  json: boolean;
  trustRecipe: boolean;
  fetch: boolean;
  skipBranch: boolean;
  retired: boolean;
  pin: string | null;
  upstream: string | null;
  reason: string | null;
  description: string | null;
  after: string | null;
  before: string | null;
  propose: boolean;
  yes: boolean;
};
export type Verb = {
  parse(args: string[]): Options;
  run(ctx: Context, o: Options, io: IO): Promise<Outcome>;
};
export type Session = { ctx: Context; io: IO; command: string; args: string[]; options?: Options; view?: unknown };

/** Reads the options a verb accepts; anything left over is a usage error. */
function reader(accepts: (keyof Options)[], positionals: number): Verb["parse"] {
  return args => {
    const has = (k: keyof Options) => accepts.includes(k),
      o: Options = {
        positional: [],
        push: has("push") && flag(args, "push"),
        inWorktree: has("inWorktree") && flag(args, "in-worktree"),
        verbose: has("verbose") && flag(args, "verbose"),
        json: has("json") && flag(args, "json"),
        trustRecipe: has("trustRecipe") && flag(args, "trust-recipe"),
        fetch: has("fetch") && flag(args, "fetch"),
        skipBranch: has("skipBranch") && flag(args, "skip-branch"),
        retired: has("retired") && flag(args, "retired"),
        pin: has("pin") ? option(args, "pin") : null,
        upstream: has("upstream") ? option(args, "upstream") : null,
        reason: has("reason") ? option(args, "reason") : null,
        description: has("description") ? option(args, "description") : null,
        after: has("after") ? option(args, "after") : null,
        before: has("before") ? option(args, "before") : null,
        propose: has("propose") && flag(args, "propose"),
        yes: has("yes") && flag(args, "yes"),
      };
    if (has("rebase")) {
      const mode = option(args, "rebase");
      if (mode !== null) {
        if (!rebaseModes.includes(mode as RebaseMode)) throw new Usage(`--rebase must be one of ${rebaseModes.join(", ")}`);
        o.rebase = mode as RebaseMode;
      }
    }
    while (o.positional.length < positionals && args.length && !args[0].startsWith("--")) o.positional.push(args.shift()!);
    return o;
  };
}

export const verbs: Record<string, Verb> = {
  add: { parse: reader(["pin", "upstream", "description", "after", "before"], 2), run: add.run },
  remove: { parse: reader(["reason"], 1), run: remove.run },
  move: { parse: reader(["after", "before", "propose", "yes", "fetch"], 1), run: move.run },
  list: { parse: reader(["retired", "verbose", "json"], 0), run: list.run },
  build: { parse: reader(["push", "rebase", "inWorktree", "trustRecipe", "verbose", "json"], 0), run: build.run },
  rebase: { parse: reader(["push", "rebase", "inWorktree", "trustRecipe", "verbose", "json", "skipBranch"], 0), run: rebase.run },
  continue: { parse: reader(["skipBranch", "verbose", "trustRecipe"], 0), run: resume.run },
  rollback: { parse: reader(["verbose"], 0), run: rollback.run },
  status: { parse: reader(["fetch", "json"], 0), run: status.run },
  recipe: { parse: reader(["json"], 0), run: recipe.run },
  trust: { parse: reader([], 0), run: trust.run },
};

type End = Extract<LiveEvent, { t: "end" }>;
type Views = { live: Live | null; tasks: TaskView | null; warnings: string[] };
const views = new WeakMap<Session, Views>();
/** An outcome as the live view's end. */
const ended = (outcome: { code: number; lines: string[]; brief?: string[]; handoffs?: number; artifact?: string }) =>
  liveEnd(outcome, null) as End;
/** The end with the run's warnings after its headline, as plain output shows them on stderr. */
const warned = (e: End, warnings: string[]): End => {
  if (!warnings.length) return e;
  const shown = warnings.map(line => `  ${line}`);
  return { ...e, lines: [...shown, ...e.lines], ...(e.brief ? { brief: [...shown, ...e.brief] } : {}) };
};

/** Turns on the live view once the arguments are good (FR-046): on a terminal
 * for the commands that run a build or rebase, or with the inline test hook.
 * `rollback` shows a checklist of its steps instead (unless `--verbose`). */
export function startView(s: Session, o: Options): void {
  s.options = o;
  const { ctx, io, command } = s,
    v: Views = { live: null, tasks: null, warnings: [] };
  views.set(s, v);
  if (io.sink || !(io.color || io.live === "inline") || o.json) return;
  if (["build", "rebase", "continue"].includes(command)) {
    const started = Live.start({
      verbose: o.verbose,
      color: !!io.color,
      command,
      ...(io.live === "inline" ? { inline: { write: io.out, rows: io.rows ?? 24, cols: io.columns ?? 80 } } : {}),
    });
    const sink = started.sink,
      ask = io.ask,
      decoder = new TextDecoder();
    ctx.progress = line => {
      if (line.startsWith("warning:")) v.warnings.push(line);
      sink({ t: "log", text: `debaser: ${line}\n` });
    };
    ctx.echo = chunk => sink({ t: "log", text: decoder.decode(chunk, { stream: true }) });
    ctx.sink = sink;
    ctx.ask = ask && (question => started.ask(question, ask));
    v.live = started;
  } else if (command === "rollback" && !o.verbose) {
    const shown = new TaskView({
      write: io.out,
      rows: () => (io.live === "inline" ? io.rows : process.stdout.rows || io.rows) ?? 24,
      cols: () => (io.live === "inline" ? io.columns : process.stdout.columns || io.columns) ?? 80,
      color: !!io.color,
      command: "rollback",
      branch: ctx.list?.branch ?? null,
      ...(io.now ? { now: () => io.now!().getTime() } : {}),
      hooks: io.live !== "inline",
    });
    ctx.task = (id, state, detail) => shown.task(id, state, detail);
    ctx.progress = line => void (line.startsWith("warning:") && v.warnings.push(line));
    ctx.echo = () => {};
    v.tasks = shown;
  }
}
/** Prints an outcome: the live view's card, `--json`'s JSON, else its lines. */
export async function endView(s: Session, outcome: Outcome): Promise<void> {
  const { io } = s,
    v = views.get(s),
    json = s.options?.json ? (outcome.json ?? outcome.result) : undefined;
  if (v?.live) return v.live.end(warned(v.live.received ?? ended(outcome), v.warnings));
  if (v?.tasks) return v.tasks.finish(warned(ended(outcome), v.warnings));
  if (json !== undefined) {
    // The summary still goes to stderr; stdout holds only the JSON.
    if (outcome.lines.length) io.err(outcome.lines.join("\n") + "\n");
    io.out(JSON.stringify(json, null, 2) + "\n");
  } else if (outcome.lines.length) {
    // A rollback on a terminal ends in a card like the views'; other commands print as they are.
    const lines = s.command === "rollback" && io.color ? outcomeCard(ended(outcome), { width: io.columns ?? 80, color: true }) : outcome.lines;
    io.out(lines.join("\n") + "\n");
  }
}
/** Ends a live view, checklist or terminal card with an error; false when the
 * plain error line should be printed instead. */
export async function failView(s: Session, error: Error): Promise<boolean> {
  const { io, command } = s,
    v = views.get(s),
    explained = error instanceof Explained ? error : null,
    failure = warned(ended({ code: 1, lines: [`debaser: ${explained?.headline ?? error.message}`, ...(explained?.lines ?? [])] }), v?.warnings ?? []);
  if (v?.live) {
    await v.live.end(failure);
    return true;
  }
  if (v?.tasks) {
    v.tasks.finish(failure);
    return true;
  }
  if (io.color && !io.sink) {
    io.err(outcomeCard(failure, { width: io.columns ?? 80, color: true, command }).join("\n") + "\n");
    return true;
  }
  return false;
}
