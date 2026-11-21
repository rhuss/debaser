import type { StreamParser, Usage } from "./types";

export type Json = Record<string, unknown>;
export type Out = { text: string[]; activity: string[] };

export const obj = (v: unknown): Json | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : undefined;
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export function oneLine(s: string): string {
  return (
    s
      .split("\n")
      .find(l => l.trim() !== "")
      ?.trim() ?? ""
  );
}
/** Text lines go to the log; the last one is the agent's latest activity. */
export function say(out: Out, text: string) {
  let last = "";
  for (const l of text.split("\n")) {
    const trimmed = l.trimEnd();
    if (trimmed.trim() === "") continue;
    out.text.push(trimmed);
    last = trimmed.trim();
  }
  if (last) out.activity.push(last);
}
/** A tool or command: logged with an arrow, and reported as activity. */
export function act(out: Out, what: string) {
  if (what === "") return;
  out.text.push(`→ ${what}`);
  out.activity.push(what);
}
/** The first string among an input's usual target fields. */
export const target = (input: Json | undefined, keys: string[]) =>
  oneLine(str(keys.map(k => input?.[k]).find(v => typeof v === "string")));

/** A JSON-lines stream parser: `event` handles each JSON object; lines that are
 * not JSON objects pass through as text. Input is split on "\n" only. */
export function jsonLines(
  event: (e: Json, out: Out, state: { add: (u: Usage) => void; fail: (reason: string | null) => void }) => void,
): StreamParser {
  let buffer = "",
    total: Usage | null = null,
    failure: string | null = null;
  const state = {
    add: (u: Usage) => {
      total = { input: (total?.input ?? 0) + u.input, output: (total?.output ?? 0) + u.output };
    },
    fail: (reason: string | null) => {
      failure = reason;
    },
  };
  const line = (raw: string, out: Out) => {
    const text = raw.replace(/\r$/, "");
    if (text.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const json = obj(parsed);
    if (!json) return say(out, text);
    event(json, out, state);
  };
  return {
    feed(chunk) {
      const out: Out = { text: [], activity: [] };
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) line(raw, out);
      return out;
    },
    flush() {
      const out: Out = { text: [], activity: [] },
        rest = buffer;
      buffer = "";
      line(rest, out);
      return out;
    },
    usage: () => total,
    failed: () => failure,
  };
}
