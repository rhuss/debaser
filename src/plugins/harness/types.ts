export type Usage = { input: number; output: number };
export type HarnessKind = "claude" | "codex" | "pi" | "opencode" | "plain";
/** Reads an agent's output stream as it arrives (contracts/plugins.md). */
export interface StreamParser {
  /** Raw chunks in; complete lines' readable text and activity out (buffered by "\n"). */
  feed(chunk: string): { text: string[]; activity: string[] };
  /** Whatever is left in the buffer at the end of the stream. */
  flush?(): { text: string[]; activity: string[] };
  /** Token usage; null when unknown (plain). */
  usage(): Usage | null;
  /** An in-stream failure reason (pi stopReason, opencode error), or null. */
  failed(): string | null;
}
export interface HarnessAdapter {
  kind: HarnessKind;
  /** The user's command plus only the flags that turn on the event stream (FR-017). */
  args(command: string[]): string[];
  parser(): StreamParser;
}
