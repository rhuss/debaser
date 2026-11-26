import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { lineReader } from "./lines";

test("an empty line answers an empty string and only the end of input answers null", async () => {
  const input = new PassThrough(),
    asked: string[] = [],
    reader = lineReader(input, text => asked.push(text));
  input.write("3\n\nyes\n");
  input.end();
  expect(await reader.line("Move which patch? ")).toBe("3");
  expect(await reader.line("To which position? ")).toBe("");
  expect(await reader.line("Move another patch? ")).toBe("yes");
  expect(await reader.line("Move which patch? ")).toBeNull();
  expect(await reader.line("Move which patch? ")).toBeNull();
  expect(asked).toEqual(["Move which patch? ", "To which position? ", "Move another patch? ", "Move which patch? ", "Move which patch? "]);
  reader.close();
});
