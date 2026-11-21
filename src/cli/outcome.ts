import type { Code } from "../core/errors";

/** How a command ended; `lines` are the summary for stdout. `brief` is what a
 * terminal's card shows of `lines` for a finished run. `json` is printed
 * instead of `lines` with `--json`. */
export type Outcome = {
  code: Code;
  lines: string[];
  brief?: string[];
  handoffs?: number;
  artifact?: string;
  json?: unknown;
  /** The run's report, for the live view's card. */
  report?: string | null;
  /** The run's `result.json`, printed with `--json` (FR-049). */
  result?: unknown;
};
