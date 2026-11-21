import type { FailureParser, ParsedFailure } from "./types";

/** The failing output without the commands debaser logged and without lines
 * that hold nothing but a path, such as the file headers a test runner prints
 * for every file it runs, so only files the failure itself names remain. */
export function failureText(log: string): string {
  return log
    .split("\n")
    .filter(line => !line.startsWith("$ ") && !/^\s*[^\s:()]+:?\s*$/.test(line))
    .join("\n");
}

/** Path-like words a failure names (outside lines that hold nothing but a path). */
export function namedPaths(log: string, root = ""): string[] {
  const found = new Set<string>(),
    prefix = root ? `${root.replace(/\/$/, "")}/` : "";
  for (const m of failureText(log).matchAll(/(?:^|[\s"'`(\[])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]+)(?=[:\s"'`()\],]|$)/gm)) {
    let path = m[1].replace(/^\.\//, "");
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
    if (!/^\d+(\.\d+)*$/.test(path)) found.add(path);
  }
  return [...found];
}

/** A step without a parser of its own: the generic log scan for implicated paths. */
export const generic: FailureParser = {
  name: "generic",
  parse(log, root): ParsedFailure {
    return { failedFiles: [], failedTests: [], implicatedPaths: namedPaths(log, root), summary: "" };
  },
};
