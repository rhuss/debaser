/** The release's pure rules: what a tag means, what an asset is called, whether
 * a version is a pre-release, and which of two versions is newer. Workflows and
 * channel jobs call this through the CLI at the bottom; the rules that can fail
 * silently therefore have tests instead of living in YAML conditionals. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Target = { os: "linux" | "darwin"; arch: "amd64" | "arm64" };

/** The four published targets, in the order the asset contract lists them. */
export const TARGETS: Target[] = [
  { os: "linux", arch: "amd64" },
  { os: "linux", arch: "arm64" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "amd64" },
];

/** The semantic-version grammar (semver.org), including pre-release and build
 * metadata. The leading zeros rule is what makes `v01.0.0` a refusal. */
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** The version a `v<version>` tag carries, without the leading `v`. Anything
 * else throws: `1.0.0`, `v1.0`, `vv1.0.0` and `v01.0.0` are all refused. */
export function parseTag(tag: string): string {
  if (!tag.startsWith("v")) throw Error(`tag ${JSON.stringify(tag)} is not of the form v<version>`);
  const version = tag.slice(1);
  if (!VERSION.test(version)) throw Error(`tag ${JSON.stringify(tag)} does not carry a semantic version`);
  return version;
}

/** The release asset name for one target: `debaser-<version>-<os>-<arch>`,
 * never with a leading `v`. */
export function assetName(version: string, target: Target): string {
  if (!VERSION.test(version)) throw Error(`${JSON.stringify(version)} is not a semantic version`);
  return `debaser-${version}-${target.os}-${target.arch}`;
}

/** True when the version carries a semantic-version pre-release suffix. Build
 * metadata is not a pre-release, even when it contains a hyphen. */
export function isPrerelease(version: string): boolean {
  return (version.split("+")[0] ?? "").includes("-");
}

type Parsed = { major: string; minor: string; patch: string; pre: string[] };

function parseVersion(version: string): Parsed {
  const match = VERSION.exec(version);
  if (!match) throw Error(`${JSON.stringify(version)} is not a semantic version`);
  return {
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** Compares two digit strings by value without going through a Number, so
 * identifiers past 2^53 keep their ordering. */
function compareNumeric(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Semantic-version precedence: negative when `a` sorts before `b`, zero when
 * they are equal, positive when `a` sorts after `b`. Build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (const part of ["major", "minor", "patch"] as const) {
    const order = compareNumeric(left[part], right[part]);
    if (order !== 0) return order;
  }
  // A version without a pre-release suffix outranks one with it (1.0.0 > 1.0.0-rc.1).
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const order = compareNumeric(x, y);
      if (order !== 0) return order;
    } else if (xNumeric) {
      return -1;
    } else if (yNumeric) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** True only when the tag is well formed and carries exactly the version the
 * tool reports. A malformed tag is a mismatch, not a crash. */
export function versionMatchesTag(tag: string, pkgVersion: string): boolean {
  try {
    return parseTag(tag) === pkgVersion;
  } catch {
    return false;
  }
}

/** One `SHA256SUMS` line in `sha256sum -c` format: the digest, two spaces, the
 * asset name. The digest is validated so a truncated value cannot slip through. */
export function sumsLine(sha256: string, name: string): string {
  const hex = sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw Error(`${JSON.stringify(sha256)} is not a SHA-256 digest`);
  if (name === "" || /\s/.test(name)) throw Error(`asset name ${JSON.stringify(name)} must not contain whitespace`);
  return `${hex}  ${name}`;
}

/** The full `SHA256SUMS` content for the four assets in `dir`, in asset order.
 * Refuses when one is missing, so a release cannot publish an incomplete file. */
export function sumsFor(version: string, dir: string): string {
  const lines = TARGETS.map((target) => {
    const name = assetName(version, target);
    const path = join(dir, name);
    if (!existsSync(path)) throw Error(`missing asset ${name} in ${dir}`);
    return sumsLine(createHash("sha256").update(readFileSync(path)).digest("hex"), name);
  });
  return `${lines.join("\n")}\n`;
}

function usage(): string {
  return [
    "usage: bun scripts/release/version.ts <command>",
    "",
    "  parse-tag <tag>                 print the version, or fail on a malformed tag",
    "  matches-tag <tag> <version>     print true when the tag carries exactly that version",
    "  is-prerelease <version>         print true or false",
    "  compare <a> <b>                 print -1, 0 or 1",
    "  is-newer <candidate> <served>   exit 0 when candidate > served, 1 when not,",
    "                                  and 2 when a version cannot be parsed",
    "  asset-name <version> <os> <arch>",
    "  sums <dir> <version>            print SHA256SUMS for the four assets in dir",
  ].join("\n");
}

function main(argv: string[]): number {
  const [command, ...args] = argv;
  switch (command) {
    case "parse-tag": {
      process.stdout.write(`${parseTag(args[0] ?? "")}\n`);
      return 0;
    }
    case "matches-tag": {
      process.stdout.write(`${versionMatchesTag(args[0] ?? "", args[1] ?? "")}\n`);
      return 0;
    }
    case "is-prerelease": {
      process.stdout.write(`${isPrerelease(args[0] ?? "")}\n`);
      return 0;
    }
    case "compare": {
      const result = compareVersions(args[0] ?? "", args[1] ?? "");
      process.stdout.write(`${result}\n`);
      return 0;
    }
    case "is-newer": {
      // 0: candidate is newer, 1: not newer, 2: a version could not be parsed.
      // The channels must not read a parse error as "not newer" and skip a
      // channel silently, so the two cases have distinct exit codes.
      try {
        return compareVersions(args[0] ?? "", args[1] ?? "") > 0 ? 0 : 1;
      } catch (error) {
        process.stderr.write(`version: ${(error as Error).message}\n`);
        return 2;
      }
    }
    case "asset-name": {
      const os = args[1];
      const arch = args[2];
      if (os !== "linux" && os !== "darwin") throw Error(`unsupported os ${JSON.stringify(os)}`);
      if (arch !== "amd64" && arch !== "arm64") throw Error(`unsupported arch ${JSON.stringify(arch)}`);
      process.stdout.write(`${assetName(args[0] ?? "", { os, arch })}\n`);
      return 0;
    }
    case "sums": {
      const [dir, version] = args;
      if (!dir || !version) throw Error("sums needs <dir> and <version>");
      process.stdout.write(sumsFor(version, dir));
      return 0;
    }
    default:
      process.stderr.write(`${command ? `unknown command ${JSON.stringify(command)}\n\n` : ""}${usage()}\n`);
      return 2;
  }
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`version: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
