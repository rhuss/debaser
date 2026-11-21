import { expect, test } from "bun:test";
import { tsc } from "./tsc";

test("tsc failures name the files with type errors", () => {
  const parsed = tsc.parse(
    "src/voice/main.ts(187,55): error TS2353: x\nsrc/voice/tuning.ts(54,5): error TS2741: y\nsrc/voice/tuning.ts(97,5): error TS7053: z\n",
    "/r",
  );
  expect(parsed.summary).toBe("3 type errors in src/voice/main.ts, src/voice/tuning.ts");
  expect(parsed.failedFiles).toEqual(["src/voice/main.ts", "src/voice/tuning.ts"]);
  expect(parsed.implicatedPaths).toEqual(["src/voice/main.ts", "src/voice/tuning.ts"]);
  expect(parsed.narrowedArgs).toBeUndefined();
  expect(tsc.parse("error: lockfile had changes", "/r").summary).toBe("");
});
