/** Renders the packaging templates at release time. A template that keeps a
 * placeholder would ship a package naming the wrong asset or checksum, so
 * `render` refuses instead of writing a half-substituted file. `licenseOf`
 * applies FR-019: no license, no package. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assetName, TARGETS } from "./version";

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*\}\}/g;

export type Arch = "amd64" | "arm64";

const HOMEPAGE = "https://github.com/rhuss/debaser";
const SUMMARY = "Keep a patched build of someone else's GitHub project";

/** Substitutes `{{name}}` for every value. A placeholder with no value, and any
 * placeholder-shaped text left after substitution, throws. */
export function render(template: string, values: Record<string, string>): string {
  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) throw Error(`no value for placeholder {{${name}}}`);
    return values[name]!;
  });
  const leftover = /\{\{[^}]*\}\}|\{\{|\}\}/.exec(rendered);
  if (leftover) throw Error(`unresolved placeholder ${JSON.stringify(leftover[0])}`);
  return rendered;
}

/** The SPDX license the project records, refused unless both the package
 * metadata and a non-empty `LICENSE` file carry it (FR-019). */
export function licenseOf(pkg: unknown, licenseFile: string | null): string {
  const record = pkg as { license?: unknown } | null;
  const license = typeof record?.license === "string" ? record.license.trim() : "";
  if (license === "") throw Error("no license in package.json: package publication is refused (FR-019)");
  const file = licenseFile !== null && existsSync(licenseFile) ? readFileSync(licenseFile, "utf8").trim() : "";
  if (file === "") throw Error("no LICENSE file: package publication is refused (FR-019)");
  return license;
}

/** Every value the templates may use, keyed by the name inside `{{ }}`. Built
 * from the four asset names and their checksums so a template cannot name an
 * asset the checksum file does not cover. */
export function valuesFor(
  version: string,
  checksums: Record<string, string>,
  license: string,
  arch: Arch = "amd64",
): Record<string, string> {
  const values: Record<string, string> = {
    version,
    license,
    arch,
    homepage: HOMEPAGE,
    summary: SUMMARY,
    base_url: `${HOMEPAGE}/releases/download/v${version}`,
  };
  for (const target of TARGETS) {
    const name = assetName(version, target);
    const digest = checksums[name];
    if (!digest) throw Error(`no checksum for ${name}`);
    values[`asset_${target.os}_${target.arch}`] = name;
    values[`sha256_${target.os}_${target.arch}`] = digest;
  }
  return values;
}

/** The templates, by path under `packaging/`, and the file each renders to. */
const TEMPLATES: Array<{ template: string; output: string }> = [
  { template: "homebrew/debaser.rb.tmpl", output: "debaser.rb" },
  { template: "aur/PKGBUILD.tmpl", output: "PKGBUILD" },
  { template: "aur/SRCINFO.tmpl", output: ".SRCINFO" },
  { template: "rpm/debaser.spec.tmpl", output: "debaser.spec" },
  { template: "deb/nfpm.yaml.tmpl", output: "nfpm.yaml" },
];

const packagingDir = join(import.meta.dir, "..", "..", "packaging");
const SUMS_LINE = /^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/;

/** Reads a `SHA256SUMS` file and refuses anything but the four assets this
 * version publishes: a missing or extra entry would make a package point at
 * the wrong file. */
export function readChecksums(path: string, version: string): Record<string, string> {
  const checksums: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const match = SUMS_LINE.exec(line.trim());
    if (!match) throw Error(`malformed SHA256SUMS line ${JSON.stringify(line)}`);
    const [, digest, name] = match;
    if (Object.hasOwn(checksums, name!)) throw Error(`duplicate asset ${name} in SHA256SUMS`);
    checksums[name!] = digest!.toLowerCase();
  }
  const expected = TARGETS.map((target) => assetName(version, target));
  const missing = expected.filter((name) => !Object.hasOwn(checksums, name));
  const extra = Object.keys(checksums).filter((name) => !expected.includes(name));
  if (missing.length > 0) throw Error(`SHA256SUMS is missing ${missing.join(", ")}`);
  if (extra.length > 0) throw Error(`SHA256SUMS has unexpected entries: ${extra.join(", ")}`);
  return checksums;
}

/** Renders every template into `out`. Returns the files written. */
export function renderAll(o: {
  version: string;
  checksums: Record<string, string>;
  license: string;
  out: string;
  arch?: Arch;
  templates?: string;
}): string[] {
  const values = valuesFor(o.version, o.checksums, o.license, o.arch);
  const dir = o.templates ?? packagingDir;
  mkdirSync(o.out, { recursive: true });
  return TEMPLATES.map(({ template, output }) => {
    const text = render(readFileSync(join(dir, template), "utf8"), values);
    const path = join(o.out, output);
    writeFileSync(path, text);
    return path;
  });
}

function usage(): string {
  return [
    "usage: bun scripts/release/render.ts --version <v> --sums <dir|file> --out <dir> [--arch amd64|arm64]",
    "",
    "Reads package.json and LICENSE from the current directory.",
    "Writes debaser.rb, PKGBUILD, .SRCINFO, debaser.spec and nfpm.yaml.",
  ].join("\n");
}

function option(args: string[], name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw Error(`--${name} needs a value`);
  return value;
}

function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const version = option(argv, "version");
  const sums = option(argv, "sums");
  const out = option(argv, "out");
  const arch = option(argv, "arch") ?? "amd64";
  if (!version || !sums || !out) throw Error(usage());
  if (arch !== "amd64" && arch !== "arm64") throw Error(`unsupported arch ${JSON.stringify(arch)}`);

  // A directory gets the standard file name; a file is read as given.
  const sumsPath = statSync(sums).isDirectory() ? join(sums, "SHA256SUMS") : sums;
  const checksums = readChecksums(sumsPath, version);
  const licensePath = join(process.cwd(), "LICENSE");
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  const license = licenseOf(pkg, existsSync(licensePath) ? licensePath : null);

  for (const path of renderAll({ version, checksums, license, out, arch }))
    process.stderr.write(`rendered ${path}\n`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`render: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
