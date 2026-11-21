import { expect, test, setDefaultTimeout } from "bun:test";
import { branch, forkBranch, git, pullRequest, world } from "./world";

setDefaultTimeout(120_000);

test("the test world publishes PR heads and fork branches", () => {
  const w = world();
  const pr = pullRequest(w, "acme/widget", 1, { "pr1.txt": "x\n" }),
    fork = forkBranch(w, "other/widget", "topic", { "topic.txt": "y\n" });
  expect(git(w.clone, "ls-remote", w.upstream, "refs/pull/1/head")).toStartWith(pr);
  expect(git(w.clone, "ls-remote", `file://${w.github}/other/widget.git`, "refs/heads/topic")).toStartWith(fork);
  expect(branch(w, "mine", { "mine.txt": "z\n" })).toMatch(/^[0-9a-f]{40}$/);
});
