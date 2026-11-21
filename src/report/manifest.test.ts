import { expect, test } from "bun:test";
import { withoutCredentials } from "./manifest";

test("the fork URL in the manifest carries no credentials", () => {
  expect(withoutCredentials("https://x-access-token:ghp_abc@github.com/me/widget.git")).toBe("https://github.com/me/widget.git");
  expect(withoutCredentials("https://me@github.com/me/widget.git")).toBe("https://github.com/me/widget.git");
  expect(withoutCredentials("git@github.com:me/widget.git")).toBe("git@github.com:me/widget.git");
  expect(withoutCredentials("/tmp/fork.git")).toBe("/tmp/fork.git");
  expect(withoutCredentials(null)).toBeNull();
});
