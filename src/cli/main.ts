import pkg from "../../package.json" with { type: "json" };
import { flag, noMore, option } from "./args";
import { usage } from "./usage";
import { lineReader } from "./lines";
import type { Outcome } from "./outcome";
import { Exit, Explained, Usage } from "../core/errors";
import { acquire } from "../core/lock";
import * as patchlist from "../core/patchlist";
import { resolveDir } from "../core/paths";
import type { Context } from "../core/context";
import * as git from "../git/git";
import type { Sink } from "../live/events";
import * as commands from "./commands";
import { forgetPrInfo } from "../github/gh";

export type IO = {
  cwd: string;
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  now?: () => Date;
  /** Asks for a line on a terminal; null when there is none. */
  ask?: (question: string) => string | null;
  /** Reads one answer on a terminal without blocking signals: "" for Enter,
   * null at the end of input; without it, `ask` answers instead. */
  line?: (question: string) => Promise<string | null>;
  /** Whether stdout is a terminal that takes colors and hyperlinks. */
  color?: boolean;
  columns?: number;
  rows?: number;
  /** Test hook: receives the live events of a run, drawing nothing. */
  sink?: Sink;
  /** Test hook: draws the live view into `out` at `columns` and `rows`, in this thread. */
  live?: "inline";
};

export const version = pkg.version;
/** Verbs that change the checkout or debaser's files take the run lock (contracts/cli.md). */
const locking = new Set(["add", "remove", "move", "build", "rebase", "continue", "rollback", "trust"]);

/** Runs one command and returns its exit code (contracts/cli.md). */
export async function main(argv: string[], io: IO): Promise<number> {
  forgetPrInfo();
  const args = [...argv];
  let dirOption: string | null;
  try {
    dirOption = option(args, "dir");
  } catch (error) {
    return usageError(io, (error as Error).message);
  }
  const command = args.shift();
  if (command === "--version" || command === "-V") {
    io.out(`debaser ${version}\n`);
    return 0;
  }
  if (!command || command === "help" || command === "--help" || command === "-h") {
    (command ? io.out : io.err)(usage + "\n");
    return command ? 0 : 1;
  }
  const handler = commands.verbs[command];
  if (!handler) return usageError(io, `unknown command ${command}`);
  let release: (() => void) | null = null,
    forget: (() => void) | null = null;
  let session: commands.Session | null = null;
  try {
    const repo = git.repoRoot(io.cwd),
      dir = resolveDir({ dir: dirOption, env: io.env, cwd: io.cwd }),
      ctx: Context = {
        repo,
        home: repo,
        dir,
        list: patchlist.load(dir),
        env: io.env,
        now: io.now ?? (() => new Date()),
        progress: line => io.err(`debaser: ${line}\n`),
        echo: chunk => io.err(new TextDecoder().decode(chunk)),
        ask: io.ask,
        line: io.line ?? (io.ask && (async question => io.ask!(question))),
        color: io.color,
        columns: io.columns,
        sink: io.sink,
      };
    session = { ctx, io, command, args };
    const parsed = handler.parse(args);
    noMore(args);
    session.options = parsed;
    commands.startView(session, parsed);
    if (locking.has(command)) {
      // A git too old for what debaser runs is refused at start, by every command that changes something.
      git.requireVersion(repo);
      release = acquire(dir, command, ctx.now());
      forget = git.onInterrupt(release);
      // Read afresh under the lock, so no other command's change is lost or reordered (FR-023).
      ctx.list = patchlist.load(dir);
    }
    const outcome: Outcome = await handler.run(ctx, parsed, io);
    await commands.endView(session, outcome);
    return outcome.code;
  } catch (error) {
    if (error instanceof Usage) return usageError(io, error.message);
    const explained = error instanceof Explained ? error : null,
      message = (error as Error).message;
    if (session && (await commands.failView(session, error as Error))) return Exit.usage;
    io.err([`debaser: ${message}`, ...(explained?.lines ?? [])].join("\n") + "\n");
    return Exit.usage;
  } finally {
    forget?.();
    release?.();
  }
}

function usageError(io: IO, message: string): number {
  io.err(`debaser: ${message}\n${usage}\n`);
  return Exit.usage;
}

if (import.meta.main) {
  // Ctrl-C, a hangup or a kill end the run where it is: the run state stays for
  // `continue` or `rollback`, and the lock is released.
  for (const [signal, code] of [
    ["SIGINT", Exit.sigint],
    ["SIGTERM", Exit.sigterm],
    ["SIGHUP", Exit.sighup],
  ] as const)
    process.on(signal, () => git.interrupt(code));
  const answers = process.stdin.isTTY ? lineReader(process.stdin, text => process.stdout.write(text)) : null;
  process.exitCode = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    out: text => process.stdout.write(text),
    err: text => process.stderr.write(text),
    // Off a terminal there is no one to ask: commands take the headless path
    // (FR-042's --trust-recipe hint, never pushing without --push).
    ask: process.stdin.isTTY ? question => prompt(question) : undefined,
    line: answers?.line,
    color: !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb",
    columns: process.stdout.isTTY ? process.stdout.columns : undefined,
    rows: process.stdout.isTTY ? process.stdout.rows : undefined,
  });
  answers?.close();
}
