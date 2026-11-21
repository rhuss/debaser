import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { onInterrupt } from "../git/git";

export type StepRun = {
  cwd: string;
  log: string;
  env: Record<string, string | undefined>;
  echo?: (chunk: Uint8Array) => void;
  /** Seconds before the step is killed and counted as failing. */
  timeout?: number;
};

/** Runs commands in order until one fails, copying their output to the log
 * and `echo`; true when all passed. A command that runs past the timeout is
 * killed with its process group and counts as failing. */
export async function runStep(cmds: string[] | string[][], o: StepRun): Promise<boolean> {
  const list = (Array.isArray(cmds[0]) ? cmds : [cmds]) as string[][];
  mkdirSync(dirname(o.log), { recursive: true });
  writeFileSync(o.log, "");
  for (const cmd of list) if (!(await runOne(cmd, o))) return false;
  return true;
}

async function runOne(cmd: string[], o: StepRun): Promise<boolean> {
  appendFileSync(o.log, `$ ${cmd.join(" ")}\n`);
  let child;
  try {
    child = Bun.spawn(cmd, { cwd: o.cwd, env: o.env, stdout: "pipe", stderr: "pipe", stdin: "ignore", detached: true });
  } catch (error) {
    appendFileSync(o.log, `${(error as Error).message}\n`);
    return false;
  }
  const killGroup = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  };
  // An interrupted debaser takes the step's processes with it.
  const forget = onInterrupt(killGroup);
  let timedOut = false;
  const timer = o.timeout
    ? setTimeout(() => {
        timedOut = true;
        killGroup();
      }, o.timeout * 1000)
    : null;
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      appendFileSync(o.log, chunk);
      o.echo?.(chunk);
    }
  };
  const pumps = Promise.all([pump(child.stdout), pump(child.stderr)]).catch(() => {});
  const code = await child.exited;
  if (timer) clearTimeout(timer);
  if (timedOut) killGroup();
  // Children left behind may hold the output open; don't wait for them long.
  await Promise.race([pumps, Bun.sleep(timedOut ? 200 : 2000)]);
  forget();
  if (timedOut) appendFileSync(o.log, `\n(killed after ${o.timeout}s: the step timed out)\n`);
  return !timedOut && code === 0;
}

/** Runs a step, and once more when it fails, so a flaky failure isn't taken
 * for a broken step; the first failure's output is kept at `keep`. `flaky`
 * means only the second run passed. `again` names what to run the second time
 * from the first failure's log (only the failed tests), or null for all of it. */
export async function runWithRetry(
  cmds: string[] | string[][],
  o: StepRun & { keep: string; onRetry?: () => void; again?: (log: string) => string[] | string[][] | null },
): Promise<{ ok: boolean; flaky: boolean }> {
  if (await runStep(cmds, o)) return { ok: true, flaky: false };
  copyFileSync(o.log, o.keep);
  o.onRetry?.();
  if (await runStep(o.again?.(readFileSync(o.keep, "utf8")) ?? cmds, o)) return { ok: true, flaky: true };
  rmSync(o.keep, { force: true });
  return { ok: false, flaky: false };
}
