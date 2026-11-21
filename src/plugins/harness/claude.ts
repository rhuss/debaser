import { act, jsonLines, num, obj, say, str, target } from "./json";
import type { HarnessAdapter } from "./types";

/** Claude Code: `--output-format stream-json --verbose`. Text from `assistant`
 * events, activity from `tool_use` items, tokens from `result.usage` with the
 * cache tokens counted as input. */
export const claude: HarnessAdapter = {
  kind: "claude",
  args: command => (command.includes("--output-format") ? command : [...command, "--output-format", "stream-json", "--verbose"]),
  parser: () =>
    jsonLines((event, out, s) => {
      if (event.type === "assistant") {
        const content = obj(event.message)?.content;
        for (const item of Array.isArray(content) ? content : []) {
          const part = obj(item);
          if (part?.type === "text") say(out, str(part.text));
          if (part?.type === "tool_use")
            act(out, `${str(part.name)} ${target(obj(part.input), ["file_path", "command", "pattern"])}`.trim());
        }
      } else if (event.type === "result") {
        const u = obj(event.usage);
        if (u)
          s.add({
            input: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
            output: num(u.output_tokens),
          });
      }
    }),
};
