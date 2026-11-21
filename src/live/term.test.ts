import { expect, test } from "bun:test";
import { link, paint } from "./term";

test("a link is underlined so it looks like one, through any reset inside it, and plain off a terminal", () => {
  expect(link("acme/gizmo#5", "https://github.com/acme/gizmo/pull/5", true)).toBe(
    "\x1b]8;;https://github.com/acme/gizmo/pull/5\x1b\\\x1b[4macme/gizmo#5\x1b[24m\x1b]8;;\x1b\\",
  );
  const painted = `${paint("a", "red", true)}b`;
  expect(link(painted, "https://x", true)).toContain("\x1b[0m\x1b[4mb\x1b[24m");
  expect(link("acme/gizmo#5", "https://github.com/acme/gizmo/pull/5", false)).toBe("acme/gizmo#5");
  expect(link("plain", null, true)).toBe("plain");
});
