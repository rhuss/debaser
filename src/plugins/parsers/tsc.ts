import { list } from "./bun-test";
import type { FailureParser, ParsedFailure } from "./types";

/** `tsc`: the files with type errors (`path(line,col): error TSnnnn`). */
export const tsc: FailureParser = {
  name: "tsc",
  parse(log): ParsedFailure {
    const errors = log.split("\n").flatMap(line => /^(\S+?)\(\d+,\d+\): error TS\d+/.exec(line)?.[1] ?? []),
      files = [...new Set(errors)];
    return {
      failedFiles: files,
      failedTests: [],
      implicatedPaths: files,
      summary: errors.length ? `${errors.length} type error${errors.length > 1 ? "s" : ""} in ${list(files, 3)}` : "",
    };
  },
};
