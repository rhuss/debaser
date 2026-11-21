import { expect, test } from "bun:test";
import { bunTest, testFailures } from "./bun-test";

export const bunLog = [
  "$ bun test src",
  "src/bindings.test.ts:",
  "(pass) a preset loads [0.20ms]",
  "(fail) no preset binds a key twice [0.61ms]",
  "",
  "src/release.test.ts:",
  "(fail) an installed release runs the current release [60001.00ms]",
  "  ^ this test timed out after 60000ms.",
  "src/voice/link.test.ts:",
  "(fail) heartbeats renew the presence > on the watch connection [0.55ms]",
  "",
  "3 tests failed:",
  "(fail) no preset binds a key twice [0.61ms]",
  "(fail) an installed release runs the current release [60001.00ms]",
  "(fail) heartbeats renew the presence > on the watch connection [0.55ms]",
  "",
  " 10 pass",
  " 3 fail",
  "Ran 13 tests across 3 files. [61.00s]",
].join("\n");

test("failed tests carry their file and whether they timed out; bun's closing summary is skipped", () => {
  expect(testFailures(bunLog)).toEqual([
    { file: "src/bindings.test.ts", name: "no preset binds a key twice", timedOut: false },
    { file: "src/release.test.ts", name: "an installed release runs the current release", timedOut: true },
    { file: "src/voice/link.test.ts", name: "heartbeats renew the presence > on the watch connection", timedOut: false },
  ]);
  expect(testFailures("$ bun test src\n 5 pass\n")).toEqual([]);
});

test("a failure summary names the failing tests and counts timeouts apart", () => {
  expect(bunTest.parse(bunLog, "/r").summary).toBe(
    "2 tests fail in 2 files (no preset binds a key twice, heartbeats renew the presence > on the watch connection); 1 timed out",
  );
  const one = bunLog.split("src/release.test.ts:")[0];
  expect(bunTest.parse(one, "/r").summary).toBe("1 test fails in src/bindings.test.ts (no preset binds a key twice)");
  expect(bunTest.parse("segfault", "/r").summary).toBe("");
});

test("a failed test run is run again on only its failing files, when bun names them", () => {
  const parsed = bunTest.parse(bunLog, "/r");
  expect(parsed.narrowedArgs).toEqual(["src/bindings.test.ts", "src/release.test.ts", "src/voice/link.test.ts"]);
  expect(parsed.failedFiles).toEqual(parsed.narrowedArgs!);
  expect(parsed.implicatedPaths).toEqual(expect.arrayContaining(parsed.failedFiles));
  expect(bunTest.parse("$ bun test src\nsegfault\n", "/r").narrowedArgs).toBeUndefined();
  // An error bun reports outside the failing tests is retried with everything.
  const unhandled = [
    "$ bun test src",
    "src/bindings.test.ts:",
    "(fail) no preset binds a key twice [0.61ms]",
    "",
    "src/broken.test.ts:",
    "# Unhandled error between tests",
    "error: Cannot find module './nope.ts' from 'src/broken.test.ts'",
    " 1 pass",
    " 1 fail",
    " 1 error",
  ].join("\n");
  expect(bunTest.parse(unhandled, "/r").narrowedArgs).toBeUndefined();
  expect(bunTest.parse("(fail) loose [1ms]\n", "/r").narrowedArgs).toBeUndefined();
});
