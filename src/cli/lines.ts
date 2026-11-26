import { createInterface, type Interface } from "node:readline";

/** Answers read line by line from `input` while the event loop stays free, so
 * Ctrl-C or a kill ends the process at once (spec 003, FR-011): "" for Enter,
 * null at the end of input. Bun's `prompt` blocks the loop and answers null to
 * both. `close` lets the process exit once the command is done. */
export function lineReader(input: NodeJS.ReadableStream, write: (text: string) => void) {
  let rl: Interface | null = null,
    lines: AsyncIterator<string> | null = null;
  return {
    line: async (question: string): Promise<string | null> => {
      write(question);
      if (!rl) {
        rl = createInterface({ input, terminal: false });
        lines = rl[Symbol.asyncIterator]();
      }
      const next = await lines!.next();
      return next.done ? null : next.value;
    },
    close: () => rl?.close(),
  };
}
