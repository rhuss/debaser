/** What a failure parser reads from a failing step's log (contracts/plugins.md). */
export type ParsedFailure = {
  /** Repo-relative files that failed (test files, files with type errors). */
  failedFiles: string[];
  failedTests: string[];
  /** Paths the failure points at, for attribution (FR-027). */
  implicatedPaths: string[];
  /** One line for stops and reports; "" when the log says nothing parseable. */
  summary: string;
  /** The value of `{tests}` for the flaky rerun; absent reruns in full. */
  narrowedArgs?: string[];
};
export interface FailureParser {
  name: string;
  parse(log: string, root: string): ParsedFailure;
}
