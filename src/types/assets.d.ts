// Text imports of embedded prompt templates and recipes:
// `import text from "./file.md" with { type: "text" }`.
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*.toml" {
  const text: string;
  export default text;
}
