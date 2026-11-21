import { expect, test } from "bun:test";
import { display, link, parse, privateRef, slug } from "./parse";

test("add arguments name upstream PRs, other repositories' PRs and branches, or own branches", () => {
  const up = "acme/widget";
  expect(parse("#123", up)).toEqual({ kind: "pr", repo: up, number: 123 });
  expect(parse("123", up)).toEqual({ kind: "pr", repo: up, number: 123 });
  expect(parse("https://github.com/acme/widget/pull/123", up)).toEqual({ kind: "pr", repo: up, number: 123 });
  expect(parse("other/widget#2", up)).toEqual({ kind: "pr", repo: "other/widget", number: 2 });
  expect(parse("https://github.com/other/widget/pull/2/", up)).toEqual({ kind: "pr", repo: "other/widget", number: 2 });
  expect(parse("other/widget:voice/dictation", up)).toEqual({ kind: "fork-branch", repo: "other/widget", branch: "voice/dictation" });
  expect(parse("https://github.com/other/widget/tree/voice", up)).toEqual({ kind: "fork-branch", repo: "other/widget", branch: "voice" });
  expect(parse("https://git.example.org/x/widget.git#branch=fix", up)).toEqual({
    kind: "fork-branch",
    url: "https://git.example.org/x/widget.git",
    branch: "fix",
  });
  expect(parse("fix-jump-to-blocked", up)).toEqual({ kind: "branch", name: "fix-jump-to-blocked" });
  expect(parse("feature/x", up)).toEqual({ kind: "branch", name: "feature/x" });
});

test("sources display as the report names them and slug into file names", () => {
  const up = "acme/widget",
    shown = (arg: string) => display(parse(arg, up));
  expect(shown("#109")).toBe("acme/widget#109");
  expect(shown("other/widget#2")).toBe("other/widget#2");
  expect(shown("other/widget:voice")).toBe("other/widget:voice");
  expect(shown("my-branch")).toBe("my-branch");
  expect(shown("https://git.example.org/x/widget.git#branch=fix")).toBe("https://git.example.org/x/widget.git:fix");
  expect(slug("acme/widget#109")).toBe("acme-widget-109");
  expect(slug("other/widget:Voice_Dictation")).toBe("other-widget-voice-dictation");
  expect(privateRef({ kind: "pr", repo: "other/widget", number: 2 })).toBe("refs/debaser/other/widget/pull/2");
  expect(privateRef({ kind: "fork-branch", repo: "other/widget", branch: "voice" })).toBe("refs/debaser/other/widget/heads/voice");
  expect(privateRef({ kind: "branch", name: "x" })).toBeNull();
  expect(link({ kind: "pr", repo: "other/widget", number: 2 })).toBe("https://github.com/other/widget/pull/2");
  expect(link({ kind: "fork-branch", repo: "other/widget", branch: "a/b#c" })).toBe("https://github.com/other/widget/tree/a/b%23c");
});
