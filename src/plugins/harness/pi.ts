import { act, jsonLines, num, obj, say, str, target } from "./json";
import type { HarnessAdapter } from "./types";

const failing = new Set(["error", "aborted", "length"]);
/** pi: `--mode json`. Text from assistant `message_end` events, activity from
 * `tool_execution_start`, tokens summed over assistant messages only; a last
 * assistant `stopReason` of error, aborted or length is an in-stream failure. */
export const pi: HarnessAdapter = {
  kind: "pi",
  args: command => (command.includes("--mode") ? command : [...command, "--mode", "json"]),
  parser: () =>
    jsonLines((event, out, s) => {
      if (event.type === "message_end") {
        const message = obj(event.message);
        if (message?.role !== "assistant") return;
        const content = message.content;
        for (const item of Array.isArray(content) ? content : []) {
          const part = obj(item);
          if (part?.type === "text") say(out, str(part.text));
        }
        const u = obj(message.usage);
        if (u) s.add({ input: num(u.input) + num(u.cacheRead) + num(u.cacheWrite), output: num(u.output) });
        const stop = str(message.stopReason);
        s.fail(failing.has(stop) ? `pi stopped: ${stop}${message.errorMessage ? `: ${str(message.errorMessage)}` : ""}` : null);
      } else if (event.type === "tool_execution_start") {
        act(out, `${str(event.toolName)} ${target(obj(event.args), ["command", "path", "pattern"])}`.trim());
      }
    }),
};
