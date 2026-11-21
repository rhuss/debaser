/** Where a patch comes from (data-model.md "Source"). */
export type BranchSource = { kind: "branch"; name: string };
export type PrSource = { kind: "pr"; repo: string; number: number };
export type ForkBranchSource = { kind: "fork-branch"; repo?: string; url?: string; branch: string };
export type Source = BranchSource | PrSource | ForkBranchSource;

/** What parsing an `add` argument needs: the upstream repository, for bare PR numbers. */
export type ParseContext = { upstreamRepo: string };
export type FetchContext = {
  repo: string;
  env: Record<string, string | undefined>;
  upstream: { repo: string; remote: string; branch: string; tip: string };
};
export type PrState = "OPEN" | "MERGED" | "CLOSED";
export type FetchedPatch = {
  /** The commit to merge. */
  commit: string;
  /** Where it was fetched to (a private ref, a local branch or origin's copy). */
  ref: string;
  pr?: { state: PrState; title: string; mergeCommit?: string; url: string; body?: string };
  /** Notes for the report: which copy of an own branch was used and why. */
  notes: string[];
};

/** One kind of patch source (contracts/plugins.md). Adding a forge or a kind is
 * one module plus one registry line. */
export interface SourceKind<S extends Source = Source> {
  kind: S["kind"];
  parse(text: string, ctx: ParseContext): S | null;
  display(s: S): string;
  slug(s: S): string;
  privateRef(s: S): string | null;
  fetch(s: S, ctx: FetchContext): FetchedPatch;
  headRepository(s: S, ctx: FetchContext): string | null;
  link(s: S): string | null;
}
