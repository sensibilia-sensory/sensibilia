const stylesheet = await Bun.file(
  new URL("tokens.css", import.meta.url),
).text();
const declarations = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
export type Theme = "dark" | "light" | "contrast";
export function tokens(theme: Theme) {
  const base = stylesheet.match(/:root\s*\{([^}]+)\}/)![1];
  const selected =
    stylesheet.match(
      new RegExp(`:root\\[data-theme=["']${theme}["']\\]\\s*\\{([^}]+)\\}`),
    )?.[1] ?? "";
  const values = { ...declarations(base), ...declarations(selected) };
  return {
    color: (name: string) => values[`--c-${name}`],
    size: (name: string) => Number(values[`--t-${name}`]),
  };
}
