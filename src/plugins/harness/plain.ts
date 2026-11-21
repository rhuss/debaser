import type { HarnessAdapter, StreamParser } from "./types";

/** Any command: its output lines pass through, tokens are unknown. */
export const plain: HarnessAdapter = {
  kind: "plain",
  args: command => command,
  parser(): StreamParser {
    let buffer = "";
    const split = (text: string) =>
      text
        .split("\n")
        .map(l => l.replace(/\r$/, "").trimEnd())
        .filter(l => l.trim() !== "");
    return {
      feed(chunk) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        return { text: split(lines.join("\n")), activity: [] };
      },
      flush() {
        const rest = buffer;
        buffer = "";
        return { text: split(rest), activity: [] };
      },
      usage: () => null,
      failed: () => null,
    };
  },
};
