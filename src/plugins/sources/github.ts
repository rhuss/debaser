/** GitHub's base URL; tests point it at local bare repositories. */
export function githubBase(env: Record<string, string | undefined> = process.env): string {
  return (env.DEBASER_GITHUB || "https://github.com").replace(/\/$/, "");
}
export const repoName = "[\\w.-]+/[\\w.-]+";
/** A display string as a file name: lowercase, runs of other characters as `-`. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "patch"
  );
}
/** A branch name as a URL path: each segment encoded, the `/` between them kept. */
export const branchPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");
