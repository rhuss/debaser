import { relative, isAbsolute } from "node:path";
import { list } from "./bun-test";
import type { FailureParser, ParsedFailure } from "./types";

/** `cargo test` (and compile errors before it): failed tests from their
 * `---- <name> stdout ----` blocks, files from `panicked at <file>:<line>` and
 * compiler `--> <file>:<line>` locations. No narrowing: cargo filters tests
 * by name, not by file. */
export const cargoTest: FailureParser = {
  name: "cargo-test",
  parse(log, root): ParsedFailure {
    const tests: string[] = [],
      files: string[] = [],
      add = (file: string) => {
        const path = isAbsolute(file) && root ? relative(root, file) : file;
        if (!files.includes(path) && !path.startsWith("/rustc/") && !path.includes(".cargo/registry")) files.push(path);
      };
    let compileErrors = 0;
    for (const line of log.split("\n")) {
      const block = /^---- (\S+) stdout ----$/.exec(line.trim());
      if (block && !tests.includes(block[1])) tests.push(block[1]);
      const panic = /panicked at (?:'[^']*', )?([^\s:]+\.rs):\d+(?::\d+)?/.exec(line);
      if (panic) add(panic[1]);
      const at = /^\s*--> ([^\s:]+\.rs):\d+(?::\d+)?/.exec(line);
      if (at) add(at[1]);
      if (/^error(\[E\d+\])?: /.test(line) && !/^error: test failed|^error: could not compile|^error: aborting/.test(line)) compileErrors++;
    }
    const result = /test result: FAILED\. (\d+) passed; (\d+) failed/.exec(log),
      summary = tests.length
        ? `${tests.length} test${tests.length > 1 ? "s" : ""} fail${tests.length > 1 ? "" : "s"} (${list(tests)})${result ? `: ${result[1]} passed, ${result[2]} failed` : ""}`
        : compileErrors
          ? `${compileErrors} compile error${compileErrors > 1 ? "s" : ""}${files.length ? ` in ${list(files, 3)}` : ""}`
          : "";
    return { failedFiles: files, failedTests: tests, implicatedPaths: files, summary };
  },
};
