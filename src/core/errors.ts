/** Exit codes, as documented in contracts/cli.md (FR-013). */
export const Exit = {
  ok: 0,
  /** Usage or precondition error; also a finished run whose push of a rebased branch was refused. */
  usage: 1,
  /** Stopped at an unresolved merge conflict, or at a rebase conflict in `rebase`. */
  conflict: 2,
  /** Stopped at a step that fails only on the patched tree. */
  step: 3,
  /** The step fails on plain upstream too. */
  upstream: 4,
  /** Harness out of attempts, fix bound reached, or a harness that kept failing to run. */
  harness: 5,
  /** Stopped at a failing acceptance check with no accepted fix. */
  acceptance: 6,
  sighup: 129,
  sigint: 130,
  sigterm: 143,
} as const;
export type Code = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A precondition error (exit 1) with lines that explain it, shown below its
 * message; a card leads with the shorter `headline` when there is one. */
export class Explained extends Error {
  readonly code = Exit.usage;
  constructor(
    message: string,
    readonly lines: string[] = [],
    readonly headline?: string,
  ) {
    super(message);
  }
}

/** A command-line usage error: the message plus the usage text. */
export class Usage extends Error {}
