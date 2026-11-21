import { expect, test } from "bun:test";
import { claude } from "./claude";
import { codex } from "./codex";
import { opencode } from "./opencode";
import { pi } from "./pi";
import { plain } from "./plain";
import { get, names } from "./registry";

const lines = (...events: unknown[]) => events.map(e => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n";

test("adapters add only the flags that turn on their event stream", () => {
  expect(claude.args(["claude-private", "-p"])).toEqual(["claude-private", "-p", "--output-format", "stream-json", "--verbose"]);
  expect(claude.args(["claude", "-p", "--output-format", "json"])).toEqual(["claude", "-p", "--output-format", "json"]);
  expect(codex.args(["codex", "exec", "-"])).toEqual(["codex", "exec", "--json", "-"]);
  expect(codex.args(["codex-wrap", "-"])).toEqual(["codex-wrap", "-", "--json"]);
  expect(codex.args(["codex", "exec", "--json", "-"])).toEqual(["codex", "exec", "--json", "-"]);
  expect(pi.args(["pi", "-p", "@x.md"])).toEqual(["pi", "-p", "@x.md", "--mode", "json"]);
  expect(opencode.args(["opencode", "run", "--auto"])).toEqual(["opencode", "run", "--auto", "--format", "json"]);
  expect(plain.args(["x", "-p"])).toEqual(["x", "-p"]);
  expect(names()).toEqual(["claude", "codex", "pi", "opencode", "plain"]);
  expect(get("pi")).toBe(pi);
});

test("claude stream gives text, tool activity and summed usage", () => {
  const parser = claude.parser();
  const assistant = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Keeping both import blocks." },
        { type: "tool_use", name: "Edit", input: { file_path: "src/controller.ts" } },
      ],
    },
  });
  const result = JSON.stringify({
    type: "result",
    subtype: "success",
    usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 49500, output_tokens: 7400 },
  });
  const stream = `${assistant}\n${result}\n`,
    cut = assistant.length / 2;
  expect(parser.feed(stream.slice(0, cut))).toEqual({ text: [], activity: [] });
  const second = parser.feed(stream.slice(cut));
  expect(second.text).toEqual(["Keeping both import blocks.", "→ Edit src/controller.ts"]);
  expect(second.activity).toEqual(["Keeping both import blocks.", "Edit src/controller.ts"]);
  expect(parser.usage()).toEqual({ input: 51000, output: 7400 });
  expect(parser.failed()).toBeNull();
});

test("codex json gives text, commands and usage, each item once", () => {
  const parser = codex.parser();
  const parsed = parser.feed(
    lines(
      { type: "item.started", item: { id: "1", type: "command_execution", command: "bun test\nmore" } },
      { type: "item.completed", item: { id: "1", type: "command_execution", command: "bun test" } },
      { type: "item.completed", item: { id: "2", type: "agent_message", text: "Fixed the import." } },
      { type: "item.completed", item: { id: "3", type: "file_change", changes: [{ path: "src/a.ts" }] } },
      { type: "turn.completed", usage: { input_tokens: 800, cached_input_tokens: 200, output_tokens: 90 } },
      "not json",
    ),
  );
  expect(parsed.text).toEqual(["→ bun test", "Fixed the import.", "→ edit src/a.ts", "not json"]);
  expect(parsed.activity).toEqual(["bun test", "Fixed the import.", "edit src/a.ts", "not json"]);
  expect(parser.usage()).toEqual({ input: 800, output: 90 });
});

test("pi gives assistant text, tool activity, usage of assistant messages and a failed stop", () => {
  const parser = pi.parser();
  const parsed = parser.feed(
    lines(
      { type: "message_end", message: { role: "user", content: [{ type: "text", text: "the prompt" }], usage: { input: 999 } } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "bun test" } },
      { type: "tool_execution_start", toolName: "edit", args: { path: "src/a.ts" } },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }], usage: { input: 100, cacheRead: 50, cacheWrite: 10, output: 20 }, stopReason: "stop" },
      },
      { type: "agent_settled" },
    ),
  );
  expect(parsed.text).toEqual(["→ bash bun test", "→ edit src/a.ts", "Done."]);
  expect(parsed.activity).toEqual(["bash bun test", "edit src/a.ts", "Done."]);
  expect(parser.usage()).toEqual({ input: 160, output: 20 });
  expect(parser.failed()).toBeNull();
  parser.feed(lines({ type: "message_end", message: { role: "assistant", content: [], usage: { input: 1, output: 1 }, stopReason: "error", errorMessage: "rate limited" } }));
  expect(parser.failed()).toBe("pi stopped: error: rate limited");
  expect(parser.usage()).toEqual({ input: 161, output: 21 });
  // Input is split on newlines only: a carriage return inside text stays in it.
  const crlf = pi.parser().feed(lines({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "a b" }] } }));
  expect(crlf.text).toEqual(["a b"]);
});

test("opencode gives text, tool activity, step tokens with cache and reasoning, and an error event", () => {
  const parser = opencode.parser();
  const parsed = parser.feed(
    lines(
      { type: "text", part: { text: "Looking at it." } },
      { type: "tool_use", part: { tool: "bash", state: { input: { command: "bun test" } } } },
      { type: "step_finish", part: { tokens: { input: 100, output: 30, reasoning: 5, cache: { read: 40, write: 2 } } } },
      { type: "step_finish", part: { tokens: { input: 10, output: 3, reasoning: 0, cache: { read: 0, write: 0 } } } },
    ),
  );
  expect(parsed.text).toEqual(["Looking at it.", "→ bash bun test"]);
  expect(parsed.activity).toEqual(["Looking at it.", "bash bun test"]);
  expect(parser.usage()).toEqual({ input: 152, output: 38 });
  expect(parser.failed()).toBeNull();
  parser.feed(lines({ type: "error", error: { name: "ProviderAuthError", data: { message: "not signed in" } } }));
  expect(parser.failed()).toBe("opencode error: not signed in");
});

test("plain output passes through, tokens unknown, and a last line without a newline is flushed", () => {
  const parser = plain.parser();
  expect(parser.feed("one\ntw")).toEqual({ text: ["one"], activity: [] });
  expect(parser.feed("o\n\nthree")).toEqual({ text: ["two"], activity: [] });
  expect(parser.flush!()).toEqual({ text: ["three"], activity: [] });
  expect(parser.usage()).toBeNull();
  expect(parser.failed()).toBeNull();
});
