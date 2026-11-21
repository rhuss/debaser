import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessTask } from "../core/runstate";
import { onInterrupt } from "../git/git";
import * as adapters from "../plugins/harness/registry";
import type { Usage } from "../plugins/harness/types";
import { executable, type Harness } from "./select";

/** A finished call: its exit code (null when killed), the last line it
 * printed, its log, its tokens and any in-stream failure the adapter saw. */
export type Call = { timedOut: boolean; code: number | null; tail: string; log: string; usage: Usage | null; failed: string | null; notExecutable?: boolean };

/** Runs the harness once on `text` (FR-017, FR-018, FR-021): the prompt goes
 * to a file named by `{prompt_file}` and by `DEBASER_PROMPT`; stdin is closed.
 * The adapter adds its streaming flags and turns the stream into readable log
 * text, activity and tokens; for a streaming adapter the raw stream is kept
 * as `.jsonl`. The harness runs in its own process group, which a timeout, the
 * end of the call or an interruption ends as a whole. */
export async function invoke(
  h: Harness,
  task: HarnessTask,
  text: string,
  o: {
    cwd: string;
    repo: string;
    reportDir: string;
    number: number;
    env: Record<string, string | undefined>;
    echo?: (chunk: Uint8Array) => void;
    onActivity?: (line: string) => void;
  },
): Promise<Call> {
  const dir = join(o.reportDir, "prompts"),
    base = join(dir, `${String(o.number).padStart(2, "0")}-${task}`),
    prompt = `${base}.md`,
    log = `${base}.log`,
    raw = `${base}.jsonl`,
    adapter = adapters.get(h.kind) ?? adapters.get("plain")!,
    streaming = adapter.kind !== "plain";
  mkdirSync(dir, { recursive: true });
  writeFileSync(prompt, text);
  const exe = executable(h.command, o.repo, o.env);
  if (!exe) {
    writeFileSync(log, `$ ${h.command.join(" ")}\nnot executable\n`);
    return { timedOut: false, code: null, tail: "not executable", log, usage: null, failed: null, notExecutable: true };
  }
  const cmd = adapter.args([exe, ...h.command.slice(1)].map(arg => arg.replaceAll("{prompt_file}", prompt))),
    parser = adapter.parser();
  writeFileSync(log, `$ ${cmd.join(" ")}\n`);
  if (streaming) writeFileSync(raw, "");
  const child = Bun.spawn(cmd, {
    cwd: o.cwd,
    env: { ...o.env, DEBASER_TASK: task, DEBASER_PROMPT: prompt },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const killGroup = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  };
  const forget = onInterrupt(killGroup);
  const encoder = new TextEncoder();
  const readable = (parsed: { text: string[]; activity: string[] }) => {
    if (parsed.text.length) {
      const lines = parsed.text.map(line => `${line}\n`).join("");
      appendFileSync(log, lines);
      o.echo?.(encoder.encode(lines));
    }
    for (const line of parsed.activity)
      try {
        o.onActivity?.(line);
      } catch {}
  };
  const pumpOut = async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      if (streaming) appendFileSync(raw, chunk);
      readable(parser.feed(decoder.decode(chunk, { stream: true })));
    }
    readable(parser.feed(decoder.decode()));
  };
  const pumpErr = async () => {
    for await (const chunk of child.stderr) {
      appendFileSync(log, chunk);
      o.echo?.(chunk);
    }
  };
  const pumps = Promise.all([pumpOut(), pumpErr()]).catch(() => {});
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, h.timeoutSeconds * 1000);
  const code = await child.exited;
  clearTimeout(timer);
  killGroup();
  forget();
  // Children it left behind may hold its output open; don't wait for them.
  await Promise.race([pumps, Bun.sleep(1000)]);
  // A last line that ended without a newline.
  if (parser.flush) readable(parser.flush());
  const tail = lastLine(readFileSync(log, "utf8"));
  appendFileSync(log, timedOut ? `\n(killed after ${h.timeoutSeconds}s)\n` : `\n(exit ${code})\n`);
  return { timedOut, code: timedOut ? null : code, tail, log, usage: parser.usage(), failed: parser.failed() };
}
/** The last non-empty line a call printed, after the command line the log starts with. */
function lastLine(log: string): string {
  const line =
    log
      .split("\n")
      .slice(1)
      .findLast(line => line.trim()) ?? "";
  return line.trim().length > 200 ? `${line.trim().slice(0, 199)}…` : line.trim();
}
/** Seconds since a `performance.now()` reading, to a tenth. */
export const since = (started: number) => Math.round((performance.now() - started) / 100) / 10;
