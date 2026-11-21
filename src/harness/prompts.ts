import acceptance from "../prompts/acceptance.md" with { type: "text" };
import check from "../prompts/check.md" with { type: "text" };
import conflict from "../prompts/conflict.md" with { type: "text" };
import handoff from "../prompts/handoff.md" with { type: "text" };
import rebaseCheck from "../prompts/rebase-check.md" with { type: "text" };
import rebaseConflict from "../prompts/rebase-conflict.md" with { type: "text" };
import type { PromptName } from "../recipes/types";

/** The prompt templates shipped inside the binary (FR-024). */
export const shipped: Record<PromptName, string> = {
  conflict,
  check,
  acceptance,
  rebase_conflict: rebaseConflict,
  rebase_check: rebaseCheck,
  handoff,
};
export type Vars = Record<string, string | number | string[] | null | undefined>;

/** Fills `{{name}}` placeholders; lists become `- item` lines, empty values `none`. */
export function fill(template: string, vars: Vars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole;
    const value = vars[name];
    if (Array.isArray(value)) return value.length ? value.map(item => `- ${item}`).join("\n") : "- none";
    return value === null || value === undefined || value === "" ? "none" : String(value);
  });
}
/** A template: the recipe's or local override's replacement, else the shipped one. */
export function template(name: PromptName, overrides: Partial<Record<PromptName, string>> = {}): string {
  return overrides[name] ?? shipped[name];
}
