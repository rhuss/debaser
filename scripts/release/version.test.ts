import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetName,
  compareVersions,
  isPrerelease,
  parseTag,
  sumsFor,
  sumsLine,
  TARGETS,
  versionMatchesTag,
} from "./version";

test("a well-formed tag yields its version without the leading v", () => {
  expect(parseTag("v0.1.0")).toBe("0.1.0");
  expect(parseTag("v1.2.3")).toBe("1.2.3");
  expect(parseTag("v0.2.0-rc.1")).toBe("0.2.0-rc.1");
  expect(parseTag("v1.0.0+build.7")).toBe("1.0.0+build.7");
});

test("a malformed tag is refused before any build", () => {
  expect(() => parseTag("0.1.0")).toThrow("v<version>");
  expect(() => parseTag("v0.1")).toThrow("semantic version");
  expect(() => parseTag("v0.1.0.0")).toThrow("semantic version");
  expect(() => parseTag("v01.0.0")).toThrow("semantic version");
  expect(() => parseTag("V1.0.0")).toThrow("v<version>");
  expect(() => parseTag("release-1.0.0")).toThrow("v<version>");
});

test("a tag with a doubled v is refused", () => {
  expect(() => parseTag("vv1.0.0")).toThrow("semantic version");
});

test("the four targets produce the asset names in the contract's order", () => {
  expect(TARGETS.map((target) => assetName("0.1.0", target))).toEqual([
    "debaser-0.1.0-linux-amd64",
    "debaser-0.1.0-linux-arm64",
    "debaser-0.1.0-darwin-arm64",
    "debaser-0.1.0-darwin-amd64",
  ]);
});

test("asset names never carry a leading v", () => {
  expect(assetName("0.1.0", { os: "linux", arch: "amd64" })).not.toContain("debaser-v");
});

test("every target gets a distinct asset name", () => {
  const names = TARGETS.map((target) => assetName("0.1.0", target));
  expect(new Set(names).size).toBe(TARGETS.length);
});

test("a checksum line is the digest, two spaces and the asset name", () => {
  const digest = "a".repeat(64);
  expect(sumsLine(digest, "debaser-0.1.0-linux-amd64")).toBe(`${digest}  debaser-0.1.0-linux-amd64`);
  expect(sumsLine(digest, "x").split(" ").length).toBe(3);
});

test("a checksum line refuses a digest that is not 64 hex characters", () => {
  expect(() => sumsLine("abc", "debaser-0.1.0-linux-amd64")).toThrow("not a SHA-256 digest");
  expect(() => sumsLine("z".repeat(64), "debaser-0.1.0-linux-amd64")).toThrow("not a SHA-256 digest");
});

test("the checksum file covers exactly the four assets in asset order", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-sums-"));
  for (const target of TARGETS) writeFileSync(join(dir, assetName("0.1.0", target)), "binary\n");
  expect(sumsFor("0.1.0", dir).trimEnd().split("\n")).toEqual(
    TARGETS.map((target) => expect.stringMatching(new RegExp(`^[0-9a-f]{64}  ${assetName("0.1.0", target)}$`))),
  );
});

test("the checksum file refuses to cover a missing asset", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-sums-"));
  writeFileSync(join(dir, "debaser-0.1.0-linux-amd64"), "binary\n");
  expect(() => sumsFor("0.1.0", dir)).toThrow("missing asset debaser-0.1.0-linux-arm64");
});

test("a tag matches only the package version it carries", () => {
  expect(versionMatchesTag("v0.1.0", "0.1.0")).toBe(true);
  expect(versionMatchesTag("v0.1.0", "0.2.0")).toBe(false);
  expect(versionMatchesTag("v0.2.0-rc.1", "0.2.0-rc.1")).toBe(true);
});

test("a version without the v prefix is not a tag and never matches", () => {
  expect(versionMatchesTag("0.1.0", "0.1.0")).toBe(false);
});

test("a malformed tag never matches, even when the text contains the version", () => {
  expect(versionMatchesTag("vv0.1.0", "0.1.0")).toBe(false);
  expect(versionMatchesTag("v0.1", "0.1")).toBe(false);
});

test("a hyphen in the version makes it a pre-release, no hyphen makes it stable", () => {
  expect(isPrerelease("0.2.0-rc.1")).toBe(true);
  expect(isPrerelease("1.0.0-alpha")).toBe(true);
  expect(isPrerelease("0.2.0")).toBe(false);
});

test("build metadata with a hyphen is not a pre-release", () => {
  expect(isPrerelease("1.0.0+build-7")).toBe(false);
});

test("versions sort by major, then minor, then patch numerically", () => {
  expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
  expect(compareVersions("0.10.0", "0.2.0")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "0.10.0")).toBeGreaterThan(0);
  expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
});

test("a pre-release sorts before its release but after the previous version", () => {
  expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBeLessThan(0);
  expect(compareVersions("0.1.0", "0.2.0-rc.1")).toBeLessThan(0);
  expect(compareVersions("0.2.0-rc.1", "0.2.0-rc.2")).toBeLessThan(0);
  expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
  expect(compareVersions("1.0.0-alpha.1", "1.0.0-beta")).toBeLessThan(0);
});

test("a malformed version is refused by the comparison instead of sorting silently", () => {
  expect(() => compareVersions("0.1", "0.1.0")).toThrow("semantic version");
});
