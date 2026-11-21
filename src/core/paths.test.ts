import { expect, test } from "bun:test";
import { resolveDir } from "./paths";

test("the config directory comes from --dir, then the environment, then the checkout", () => {
  const commonDir = "/repo/.git";
  expect(resolveDir({ env: {}, cwd: "/repo", commonDir })).toBe("/repo/.git/debaser");
  expect(resolveDir({ env: { DEBASER_DIR: "/dots/widget" }, cwd: "/repo", commonDir })).toBe("/dots/widget");
  expect(resolveDir({ env: { DEBASER_DIR: "" }, cwd: "/repo", commonDir })).toBe("/repo/.git/debaser");
  expect(resolveDir({ dir: "/opt/db", env: { DEBASER_DIR: "/dots/widget" }, cwd: "/repo", commonDir })).toBe(
    "/opt/db",
  );
  expect(resolveDir({ dir: "rel", env: {}, cwd: "/here", commonDir })).toBe("/here/rel");
});
