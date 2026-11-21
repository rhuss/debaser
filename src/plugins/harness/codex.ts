import { act, jsonLines, num, obj, oneLine, say, str } from "./json";
import type { HarnessAdapter, StreamParser } from "./types";

/** Codex: `--json` (after `exec` when present). Text from `agent_message`
 * items, activity from commands and file changes (each item once), tokens from
 * `turn.completed.usage` (input already includes the cached input). */
export const codex: HarnessAdapter = {
  kind: "codex",
  args(command) {
    if (command.includes("--json")) return command;
    const exec = command.indexOf("exec");
    if (exec < 0) return [...command, "--json"];
    return [...command.slice(0, exec + 1), "--json", ...command.slice(exec + 1)];
  },
  parser(): StreamParser {
    const seen = new Set<string>();
    return jsonLines((event, out, s) => {
      const type = str(event.type);
      if (type.startsWith("item.")) {
        const item = obj(event.item);
        if (!item) return;
        // Codex reports an item when it starts and again when it completes; show it once.
        const id = typeof item.id === "string" ? item.id : null;
        if (id !== null && seen.has(id)) return;
        const before = out.text.length;
        if (item.type === "agent_message") say(out, str(item.text));
        else if (item.type === "command_execution") act(out, oneLine(str(item.command)));
        else if (item.type === "file_change") {
          const first = obj(Array.isArray(item.changes) ? item.changes[0] : undefined);
          act(out, `edit ${str(first?.path)}`.trim());
        }
        if (id !== null && out.text.length > before) seen.add(id);
      } else if (type === "turn.completed") {
        const u = obj(event.usage);
        if (u) s.add({ input: num(u.input_tokens), output: num(u.output_tokens) });
      }
    });
  },
};
