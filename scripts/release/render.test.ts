import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { licenseOf, readChecksums, render, valuesFor, type Arch } from "./render";

const DIGEST = "a".repeat(64);

const templatePath = (path: string) => join(import.meta.dir, "..", "..", "packaging", path);

/** Four distinct digests, one per asset, so a template that swaps two assets
 * is visible in the rendered text. */
function checksumsFor(version: string): Record<string, string> {
  return {
    [`debaser-${version}-linux-amd64`]: "1".repeat(64),
    [`debaser-${version}-linux-arm64`]: "2".repeat(64),
    [`debaser-${version}-darwin-arm64`]: "3".repeat(64),
    [`debaser-${version}-darwin-amd64`]: "4".repeat(64),
  };
}

function renderTemplate(path: string, version = "0.1.0", arch: Arch = "amd64"): string {
  return render(readFileSync(templatePath(path), "utf8"), valuesFor(version, checksumsFor(version), "MIT", arch));
}

test("a placeholder is replaced by its value", () => {
  expect(render("debaser {{version}} on {{os}}", { version: "0.1.0", os: "linux" })).toBe("debaser 0.1.0 on linux");
});

test("spaces inside the braces are allowed", () => {
  expect(render("{{ version }}", { version: "0.1.0" })).toBe("0.1.0");
});

test("a placeholder with no value is refused instead of written through", () => {
  expect(() => render("{{version}}-{{asset}}", { version: "0.1.0" })).toThrow("no value for placeholder {{asset}}");
});

test("a placeholder-shaped leftover is refused", () => {
  expect(() => render("{{ not a name }}", {})).toThrow("unresolved placeholder");
  expect(() => render("broken {{", {})).toThrow("unresolved placeholder");
});

test("a license is read from package.json when a LICENSE file records it too", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-license-"));
  const file = join(dir, "LICENSE");
  writeFileSync(file, "MIT License\n\nCopyright (c) someone\n");
  expect(licenseOf({ license: "MIT" }, file)).toBe("MIT");
});

test("no license in package metadata refuses package publication", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-license-"));
  const file = join(dir, "LICENSE");
  writeFileSync(file, "MIT License\n");
  expect(() => licenseOf({}, file)).toThrow("no license in package.json");
  expect(() => licenseOf({ license: "   " }, file)).toThrow("no license in package.json");
});

test("no LICENSE file refuses package publication", () => {
  expect(() => licenseOf({ license: "MIT" }, null)).toThrow("no LICENSE file");
  expect(() => licenseOf({ license: "MIT" }, "/nonexistent/LICENSE")).toThrow("no LICENSE file");
});

test("an empty LICENSE file is no license", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-license-"));
  const file = join(dir, "LICENSE");
  writeFileSync(file, "\n");
  expect(() => licenseOf({ license: "MIT" }, file)).toThrow("no LICENSE file");
});

test("the values carry the four asset names and their checksums", () => {
  const checksums = {
    "debaser-0.1.0-linux-amd64": DIGEST,
    "debaser-0.1.0-linux-arm64": "b".repeat(64),
    "debaser-0.1.0-darwin-arm64": "c".repeat(64),
    "debaser-0.1.0-darwin-amd64": "d".repeat(64),
  };
  const values = valuesFor("0.1.0", checksums, "MIT");
  expect(values.asset_linux_amd64).toBe("debaser-0.1.0-linux-amd64");
  expect(values.sha256_darwin_arm64).toBe("c".repeat(64));
  expect(values.base_url).toBe("https://github.com/rhuss/debaser/releases/download/v0.1.0");
  expect(values.arch).toBe("amd64");
});

test("the values refuse an asset the checksum file does not cover", () => {
  expect(() => valuesFor("0.1.0", {}, "MIT")).toThrow("no checksum for debaser-0.1.0-linux-amd64");
});

test("the checksum file must cover all four assets", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-sums-"));
  const path = join(dir, "SHA256SUMS");
  writeFileSync(path, `${DIGEST}  debaser-0.1.0-linux-amd64\n`);
  expect(() => readChecksums(path, "0.1.0")).toThrow("missing");
});

test("the checksum file refuses an entry that is not a release asset", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-sums-"));
  const path = join(dir, "SHA256SUMS");
  const lines = [
    `${DIGEST}  debaser-0.1.0-linux-amd64`,
    `${DIGEST}  debaser-0.1.0-linux-arm64`,
    `${DIGEST}  debaser-0.1.0-darwin-arm64`,
    `${DIGEST}  debaser-0.1.0-darwin-amd64`,
    `${DIGEST}  notes.txt`,
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
  expect(() => readChecksums(path, "0.1.0")).toThrow("unexpected entries: notes.txt");
});

test("the checksum file refuses a malformed line", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-sums-"));
  const path = join(dir, "SHA256SUMS");
  writeFileSync(path, "not a checksum line\n");
  expect(() => readChecksums(path, "0.1.0")).toThrow("malformed SHA256SUMS line");
});

test("the Homebrew formula points each platform at its own asset and checksum", () => {
  const formula = renderTemplate("homebrew/debaser.rb.tmpl");
  for (const [platform, digit] of [
    ["darwin-arm64", "3"],
    ["darwin-amd64", "4"],
    ["linux-arm64", "2"],
    ["linux-amd64", "1"],
  ] as const) {
    expect(formula).toContain(
      `url "https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-${platform}"`,
    );
    expect(formula).toContain(`sha256 "${digit.repeat(64)}"`);
  }
});

test("the Homebrew formula splits macOS and Linux by hardware", () => {
  const formula = renderTemplate("homebrew/debaser.rb.tmpl");
  expect(formula).toMatch(/on_macos do[\s\S]*Hardware::CPU\.arm\?[\s\S]*on_linux do[\s\S]*Hardware::CPU\.arm\?/);
});

test("the Homebrew formula declares git and tests the installed command", () => {
  const formula = renderTemplate("homebrew/debaser.rb.tmpl");
  expect(formula).toContain('depends_on "git"');
  expect(formula).toContain('license "MIT"');
  expect(formula).toMatch(/def install[\s\S]*bin\.install[\s\S]*=> "debaser"/);
  expect(formula).toMatch(/test do[\s\S]*debaser --version[\s\S]*end/);
});

test("the Homebrew formula leaves no placeholder behind", () => {
  expect(renderTemplate("homebrew/debaser.rb.tmpl")).not.toContain("{{");
});

test("the Debian package carries the release version, license and git floor", () => {
  const nfpm = renderTemplate("deb/nfpm.yaml.tmpl");
  expect(nfpm).toContain("name: debaser");
  expect(nfpm).toContain("version: 0.1.0");
  expect(nfpm).toContain("license: MIT");
  expect(nfpm).toContain("git (>= 2.38)");
  expect(nfpm).toContain("dst: /usr/bin/debaser");
  expect(nfpm).not.toContain("{{");
});

test("the Debian package is rendered for the requested architecture", () => {
  expect(renderTemplate("deb/nfpm.yaml.tmpl", "0.1.0", "amd64")).toContain("arch: amd64");
  expect(renderTemplate("deb/nfpm.yaml.tmpl", "0.1.0", "arm64")).toContain("arch: arm64");
});

test("the RPM spec carries both Linux assets and maps each architecture to one", () => {
  const spec = renderTemplate("rpm/debaser.spec.tmpl");
  expect(spec).toContain(
    "Source0:        https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-linux-amd64",
  );
  expect(spec).toContain(
    "Source1:        https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-linux-arm64",
  );
  expect(spec).toMatch(/%ifarch x86_64\ninstall -D -m 0755 %\{SOURCE0\}/);
  expect(spec).toMatch(/%ifarch aarch64\ninstall -D -m 0755 %\{SOURCE1\}/);
  expect(spec).toContain("ExclusiveArch:  x86_64 aarch64");
});

test("the RPM spec verifies each architecture's asset against the published checksums", () => {
  const spec = renderTemplate("rpm/debaser.spec.tmpl");
  expect(spec).toContain("Source2:        https://github.com/rhuss/debaser/releases/download/v0.1.0/SHA256SUMS");
  expect(spec).toContain('line=$(grep " debaser-0.1.0-linux-amd64$" SHA256SUMS) || exit 1');
  expect(spec).toContain('line=$(grep " debaser-0.1.0-linux-arm64$" SHA256SUMS) || exit 1');
  expect(spec).toContain('printf \'%s\\n\' "$line" | sha256sum -c -');
});

test("the RPM spec leaves the prebuilt binary unstripped", () => {
  const spec = renderTemplate("rpm/debaser.spec.tmpl");
  expect(spec).toContain("%global __strip /bin/true");
  expect(spec).toContain("%global debug_package %{nil}");
});

test("the RPM spec carries the release version, license and git floor", () => {
  const spec = renderTemplate("rpm/debaser.spec.tmpl");
  expect(spec).toContain("Version:        0.1.0");
  expect(spec).toContain("License:        MIT");
  expect(spec).toContain("Requires:       git >= 2.38");
  expect(spec).toContain("%license /usr/share/licenses/debaser/LICENSE");
  expect(spec).not.toContain("{{");
});

test("the PKGBUILD downloads each architecture's asset with its checksum", () => {
  const pkgbuild = renderTemplate("aur/PKGBUILD.tmpl");
  expect(pkgbuild).toContain(
    'source_x86_64=("https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-linux-amd64")',
  );
  expect(pkgbuild).toContain("sha256sums_x86_64=('" + "1".repeat(64) + "')");
  expect(pkgbuild).toContain(
    'source_aarch64=("https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-linux-arm64")',
  );
  expect(pkgbuild).toContain("sha256sums_aarch64=('" + "2".repeat(64) + "')");
});

test("the PKGBUILD declares the package metadata and the git floor", () => {
  const pkgbuild = renderTemplate("aur/PKGBUILD.tmpl");
  expect(pkgbuild).toContain("pkgname=debaser-bin");
  expect(pkgbuild).toContain("pkgver=0.1.0");
  expect(pkgbuild).toContain("arch=('x86_64' 'aarch64')");
  expect(pkgbuild).toContain("license=('MIT')");
  expect(pkgbuild).toContain("depends=('git>=2.38')");
  expect(pkgbuild).toContain("/usr/bin/debaser");
  expect(pkgbuild).not.toContain("{{");
});

test("the PKGBUILD leaves the prebuilt binary unstripped", () => {
  const pkgbuild = renderTemplate("aur/PKGBUILD.tmpl");
  expect(pkgbuild).toContain("options=('!strip' '!debug')");
});

test("the .SRCINFO mirrors the PKGBUILD field for field", () => {
  const srcinfo = renderTemplate("aur/SRCINFO.tmpl");
  expect(srcinfo).toContain("pkgbase = debaser-bin");
  expect(srcinfo).toContain("\tpkgver = 0.1.0");
  expect(srcinfo).toContain("\tpkgrel = 1");
  expect(srcinfo).toContain("\tlicense = MIT");
  expect(srcinfo).toContain("\tdepends = git>=2.38");
  expect(srcinfo).toContain("\toptions = !strip");
  expect(srcinfo).toContain("\toptions = !debug");
  expect(srcinfo).toContain(
    "\tsource_x86_64 = https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-linux-amd64",
  );
  expect(srcinfo).toContain(`\tsha256sums_x86_64 = ${"1".repeat(64)}`);
  expect(srcinfo).toContain(
    "\tsource_aarch64 = https://github.com/rhuss/debaser/releases/download/v0.1.0/debaser-0.1.0-linux-arm64",
  );
  expect(srcinfo).toContain(`\tsha256sums_aarch64 = ${"2".repeat(64)}`);
  expect(srcinfo).toContain("pkgname = debaser-bin");
  expect(srcinfo).not.toContain("{{");
});

test("the checksum file accepts sha256sum's binary-mode marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-sums-"));
  const path = join(dir, "SHA256SUMS");
  const lines = [
    `${DIGEST} *debaser-0.1.0-linux-amd64`,
    `${DIGEST}  debaser-0.1.0-linux-arm64`,
    `${DIGEST}  debaser-0.1.0-darwin-arm64`,
    `${DIGEST}  debaser-0.1.0-darwin-amd64`,
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
  expect(readChecksums(path, "0.1.0")["debaser-0.1.0-linux-amd64"]).toBe(DIGEST);
});

const TEMPLATES = ["homebrew/debaser.rb.tmpl", "aur/PKGBUILD.tmpl", "aur/SRCINFO.tmpl", "rpm/debaser.spec.tmpl", "deb/nfpm.yaml.tmpl"];

test("every template renders the requested version, not the current package version", () => {
  // A template that hardcoded 0.1.0 (today's package version) would pass every
  // other test, but the next release would ship the wrong version.
  const version = "9.8.7";
  for (const path of TEMPLATES) {
    const text = render(readFileSync(templatePath(path), "utf8"), valuesFor(version, checksumsFor(version), "MIT"));
    expect(text).toContain(version);
    expect(text).not.toContain("0.1.0");
    expect(text).not.toContain("{{");
    // nfpm takes the binary from the directory beside it, not from a URL.
    if (path !== "deb/nfpm.yaml.tmpl") expect(text).toContain(`releases/download/v${version}`);
  }
});

test("the license comes from the metadata, not from a template constant", () => {
  const values = valuesFor("0.1.0", checksumsFor("0.1.0"), "Apache-2.0");
  for (const path of TEMPLATES) {
    const text = render(readFileSync(templatePath(path), "utf8"), values);
    expect(text).toContain("Apache-2.0");
    expect(text).not.toContain("MIT");
  }
});

test("each Homebrew branch pairs its url with its own digest", () => {
  const formula = renderTemplate("homebrew/debaser.rb.tmpl");
  for (const [platform, digit] of [
    ["darwin-arm64", "3"],
    ["darwin-amd64", "4"],
    ["linux-arm64", "2"],
    ["linux-amd64", "1"],
  ] as const) {
    expect(formula).toMatch(
      new RegExp(`url "[^"]*debaser-0\\.1\\.0-${platform}"\\n\\s*sha256 "${digit.repeat(64)}"`),
    );
  }
});

test("the packages install the downloaded asset, not another file", () => {
  expect(renderTemplate("deb/nfpm.yaml.tmpl")).toContain("src: ./debaser");
  const pkgbuild = renderTemplate("aur/PKGBUILD.tmpl");
  expect(pkgbuild).toContain('asset="debaser-0.1.0-linux-amd64"');
  expect(pkgbuild).toContain('asset="debaser-0.1.0-linux-arm64"');
  expect(pkgbuild).toContain('install -Dm755 "${srcdir}/$asset" "${pkgdir}/usr/bin/debaser"');
  expect(pkgbuild).not.toContain("source[0]");
  expect(renderTemplate("homebrew/debaser.rb.tmpl")).toContain('Dir["debaser-*"]');
});

test("a license that could inject package structure is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-license-"));
  const file = join(dir, "LICENSE");
  writeFileSync(file, "MIT License\n");
  expect(() => licenseOf({ license: "MIT\n%post\nrm -rf /" }, file)).toThrow("SPDX license expression");
  expect(() => licenseOf({ license: 'MIT"; system("x")' }, file)).toThrow("SPDX license expression");
});
