import { expect, test } from "bun:test";
import { requireVersion } from "./git";
import { repositoryOf, sameRepository } from "./remotes";

test("a git older than 2.38 is refused with the minimum version", () => {
  expect(() => requireVersion("/", "2.38", "2.37.1")).toThrow("git 2.38 or newer is required (found 2.37.1)");
  expect(() => requireVersion("/", "2.38", "2.38.0")).not.toThrow();
  expect(() => requireVersion("/", "2.38", "2.56.0 (Apple Git-1)")).not.toThrow();
});

test("remote URLs compare by repository, however they are spelled", () => {
  const same = [
    "git@github.com:Me/Widget.git",
    "https://github.com/me/widget",
    "ssh://git@github.com:22/me/widget.git",
    "https://user@github.com/me/widget/",
  ].map(repositoryOf);
  expect(new Set(same).size).toBe(1);
  expect(repositoryOf("file:///tmp/github/me/widget.git")).toBe("/tmp/github/me/widget");
  expect(repositoryOf("git@host:1234/repo")).toBe("host/1234/repo");
  expect(sameRepository("me/widget", "github.com/me/widget")).toBe(true);
  expect(sameRepository("me/widget", "/tmp/github/me/widget")).toBe(true);
  expect(sameRepository("acme/widget", "github.com/me/widget")).toBe(false);
});
