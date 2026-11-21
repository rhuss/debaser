import { namedPaths } from "./generic";
import type { FailureParser, ParsedFailure } from "./types";

export type TestFailure = { file: string | null; name: string; timedOut: boolean };
/** The failed tests in `bun test` output, each with the file it ran in (null
 * when the output doesn't say). The summary bun repeats at the end is skipped. */
export function testFailures(log: string): TestFailure[] {
  const out: TestFailure[] = [];
  let file: string | null = null;
  for (const line of log.split("\n")) {
    if (/^\d+ tests? (failed|skipped|todo):?$/.test(line.trim()) || /^Ran \d+ tests?/.test(line)) break;
    const header = /^(\S+\.(test|spec)\.[cm]?[jt]sx?):$/.exec(line);
    if (header) file = header[1];
    else if (line.startsWith("(fail) ")) out.push({ file, name: line.slice(7).replace(/ \[[\d.]+m?s\]$/, ""), timedOut: false });
    else if (/^\s*\^ this test timed out/.test(line) && out.length) out[out.length - 1].timedOut = true;
  }
  return out;
}
export const list = (items: string[], n = 2) => items.slice(0, n).join(", ") + (items.length > n ? `, +${items.length - n} more` : "");

/** `bun test`: failing tests with their files; the flaky rerun runs only those files. */
export const bunTest: FailureParser = {
  name: "bun-test",
  parse(log, root): ParsedFailure {
    const failures = testFailures(log),
      failed = failures.filter(f => !f.timedOut),
      timedOut = failures.length - failed.length,
      files = [...new Set(failures.flatMap(f => f.file ?? []))],
      failedFiles = [...new Set(failed.flatMap(f => f.file ?? []))],
      where = failedFiles.length === 1 ? ` in ${failedFiles[0]}` : failedFiles.length ? ` in ${failedFiles.length} files` : "",
      summary = failures.length
        ? [
            ...(failed.length
              ? [`${failed.length} test${failed.length > 1 ? "s" : ""} fail${failed.length > 1 ? "" : "s"}${where} (${list(failed.map(f => f.name))})`]
              : []),
            ...(timedOut ? [`${timedOut} timed out`] : []),
          ].join("; ")
        : "",
      // An error bun reports outside the failing tests, like a file it could not
      // load, names no file to narrow to: rerun everything, or it never runs again.
      narrowable = failures.length > 0 && failures.every(f => f.file) && !/# Unhandled error|^ \d+ errors?$/m.test(log);
    return {
      failedFiles: files,
      failedTests: failures.map(f => f.name),
      implicatedPaths: [...new Set([...files, ...namedPaths(log, root)])],
      summary,
      ...(narrowable ? { narrowedArgs: files } : {}),
    };
  },
};
