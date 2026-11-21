import { act, jsonLines, num, obj, say, str, target } from "./json";
import type { HarnessAdapter } from "./types";

/** opencode: `--format json`. Text from `text` events, activity from
 * `tool_use`, tokens summed over `step_finish` (cache in input, reasoning in
 * output); an `error` event is an in-stream failure. */
export const opencode: HarnessAdapter = {
  kind: "opencode",
  args: command => (command.includes("--format") ? command : [...command, "--format", "json"]),
  parser: () =>
    jsonLines((event, out, s) => {
      const part = obj(event.part);
      if (event.type === "text") say(out, str(part?.text));
      else if (event.type === "tool_use")
        act(out, `${str(part?.tool)} ${target(obj(obj(part?.state)?.input), ["command", "path", "filePath", "pattern"])}`.trim());
      else if (event.type === "step_finish") {
        const t = obj(part?.tokens),
          cache = obj(t?.cache);
        if (t) s.add({ input: num(t.input) + num(cache?.read) + num(cache?.write), output: num(t.output) + num(t.reasoning) });
      } else if (event.type === "error") {
        const e = obj(event.error),
          message = str(obj(e?.data)?.message) || str(e?.message) || str(e?.name) || "error event";
        say(out, `error: ${message}`);
        s.fail(`opencode error: ${message}`);
      }
    }),
};
